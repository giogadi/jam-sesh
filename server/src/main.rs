#[macro_use]
extern crate serde_derive;

extern crate serde;
extern crate serde_json;
extern crate websocket;

use std::sync::{Mutex, Arc};
use std::sync::mpsc;
use std::thread;
use websocket::OwnedMessage;
use websocket::sync::Server;
use websocket::ws::Receiver;

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
struct ClientId(usize);

#[derive(Debug,Clone)]
struct MessageToClients {
    from_id: ClientId,
    data: String
}

enum MessageToMain {
    Update(MessageToClients),
    Disconnect(ClientId)
}

#[derive(Serialize, Debug)]
struct ClientState {
    sequence: Vec<bool>,
    instrument: String
}

fn serve_client(to_main: mpsc::Sender<MessageToMain>,
                from_main: mpsc::Receiver<MessageToClients>,
                client: websocket::sync::Client<std::net::TcpStream>,
                id: ClientId) {
    client.stream_ref().set_read_timeout(
        Some(std::time::Duration::new(1, 0))).ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
    loop {
        let result = from_client.receiver.recv_message(&mut from_client.stream);
        match result {
            Ok(OwnedMessage::Text(s)) => {
                // TODO separate logging
                println!("{} {}", id.0, &s);
                let to_main_message = MessageToClients {
                    from_id: id,
                    data: s
                };
                to_main.send(MessageToMain::Update(to_main_message)).unwrap();
            }
            Ok(OwnedMessage::Close(maybe_close_data)) => {
                let disconnect_string =
                    match maybe_close_data {
                        Some(close_data) => close_data.reason,
                        None => "".to_string()
                    };
                // TODO separate logging
                // TODO output ip addr too
                println!("Client {}) disconnected: {}",
                         id.0, disconnect_string);
                to_main.send(MessageToMain::Disconnect(id)).unwrap();
                break;
            }
            // TODO log what else could happen here
            _ => (),
        }
        let result = from_main.try_recv();
        match result {
            Ok(message_from_main) => {
                assert_ne!(message_from_main.from_id, id);
                let message_to_client =
                    OwnedMessage::Text(message_from_main.data);
                to_client.send_message(&message_to_client).ok();
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => (),
            Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                println!("{:?}", &result);
            }
        }
    }
}

fn main() {
    let server = Server::bind("0.0.0.0:2794").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<(ClientId,
                                    mpsc::Sender<MessageToClients>)>>> =
        Arc::new(Mutex::new(Vec::new()));
    let thread_connections = Arc::clone(&connections);
    thread::spawn(move || {
        for request in server.filter_map(Result::ok) {
            if !request.protocols().contains(&"giogadi".to_string()) {
                request.reject().unwrap();
                continue;
            }
            let client = request.use_protocol("giogadi").accept().unwrap();
            let ip = client.peer_addr().unwrap();
            // TODO separate connection logs from message transmission
            // logs
            println!("Connection from {}", ip);
            let mut connections = thread_connections.lock().unwrap();
            let new_id = ClientId(connections.len());
            let (to_thread, from_main) = mpsc::channel();
            connections.push((new_id, to_thread));
            let to_main_clone = to_main.clone();
            thread::spawn(move || {
                serve_client(to_main_clone, from_main, client, new_id);
            });
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        match msg_from_client {
            MessageToMain::Update(msg_to_clients) => {
                for &(c_id, ref to_thread) in connections.iter() {
                    if msg_to_clients.from_id == c_id {
                        continue;
                    }
                    // TODO can we make this a move?
                    to_thread.send(msg_to_clients.clone()).unwrap();
                }
            }
            MessageToMain::Disconnect(disconnecting_id) => {
                let default_client_state = ClientState {
                    sequence: vec![false; 16],
                    instrument: "kick".to_string()
                };
                let state_json =
                    serde_json::to_string(&default_client_state).unwrap();
                let message_to_clients = MessageToClients {
                    from_id: disconnecting_id,
                    data: state_json
                };
                let mut disconnecting_ix: Option<usize> = None;
                for (c_ix, &(c_id, ref to_thread)) in
                    connections.iter().enumerate() {
                    if c_id == disconnecting_id {
                        disconnecting_ix = Some(c_ix);
                    } else {
                        to_thread.send(message_to_clients.clone()).unwrap();
                    }
                }
                connections.swap_remove(disconnecting_ix.unwrap());
            }
        }
    }
}
