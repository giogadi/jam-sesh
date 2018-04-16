#[macro_use]
extern crate serde_derive;

extern crate serde;
extern crate serde_json;
extern crate websocket;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use websocket::sync::Server;
use websocket::ws::Receiver;
use websocket::OwnedMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ClientId(usize);

#[derive(Serialize, Deserialize, Debug)]
struct MessageOutToClient {
    client_id: usize,
    update_type: String, // Can be "state" or "disconnect"
    client_state: StateFromClient,
}

#[derive(Debug, Clone)]
enum Update {
    State(StateFromClient),
    Disconnect,
}

#[derive(Debug, Clone)]
struct UpdateMessageFromClientHandler {
    client_id: ClientId,
    update: Update,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct StateFromClient {
    sequence: Vec<bool>,
    instrument: String,
}

// TODO: Currently, when a new client connects, it doesn't know the
// state of any of the other clients until they send a message. Maybe
// store the latest version of known state from all currently
// connected clients and send that message to the new client upon
// connection.
fn serve_client(
    to_main: mpsc::Sender<UpdateMessageFromClientHandler>,
    from_main: mpsc::Receiver<UpdateMessageFromClientHandler>,
    client: websocket::sync::Client<std::net::TcpStream>,
    id: ClientId,
) {
    client
        .stream_ref()
        .set_read_timeout(Some(std::time::Duration::new(1, 0)))
        .ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
    loop {
        let result = from_client
            .receiver
            .recv_message(&mut from_client.stream);
        match result {
            Ok(OwnedMessage::Text(s)) => {
                // TODO separate logging
                println!("{} {}", id.0, &s);
                let update_to_other_clients = UpdateMessageFromClientHandler {
                    client_id: id,
                    update: Update::State(serde_json::from_str(&s).unwrap()),
                };
                to_main.send(update_to_other_clients).unwrap();
            }
            Ok(OwnedMessage::Close(maybe_close_data)) => {
                let disconnect_string = match maybe_close_data {
                    Some(close_data) => close_data.reason,
                    None => "".to_string(),
                };
                // TODO separate logging
                // TODO output ip addr too
                println!(
                    "Client {} disconnected: {}",
                    id.0, disconnect_string
                );
                // TODO I guess we technically update the main thread
                // as well ugh
                let update_to_other_clients = UpdateMessageFromClientHandler {
                    client_id: id,
                    update: Update::Disconnect,
                };
                to_main.send(update_to_other_clients).unwrap();
                break;
            }
            // TODO log what else could happen here
            _ => (),
        }
        let result = from_main.try_recv();
        match result {
            Ok(message_from_main) => {
                assert_ne!(message_from_main.client_id, id);
                let message_to_client = match message_from_main.update {
                    Update::State(client_state) => MessageOutToClient {
                        client_id: message_from_main.client_id.0,
                        // TODO: read about strings plsthx
                        update_type: "state".to_string(),
                        client_state: client_state,
                    },
                    Update::Disconnect => MessageOutToClient {
                        client_id: message_from_main.client_id.0,
                        update_type: "disconnect".to_string(),
                        client_state: StateFromClient {
                            sequence: vec![],
                            instrument: "".to_string(),
                        },
                    },
                };
                let json_msg =
                    serde_json::to_string(&message_to_client).unwrap();
                to_client
                    .send_message(&OwnedMessage::Text(json_msg))
                    .unwrap();
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
    let connections: Arc<
        Mutex<
            Vec<(
                ClientId,
                mpsc::Sender<UpdateMessageFromClientHandler>,
            )>,
        >,
    > = Arc::new(Mutex::new(Vec::new()));
    let thread_connections = Arc::clone(&connections);
    thread::spawn(move || {
        let mut next_id = 0;
        for request in server.filter_map(Result::ok) {
            if !request
                .protocols()
                .contains(&"giogadi".to_string())
            {
                request.reject().unwrap();
                continue;
            }
            let client = request
                .use_protocol("giogadi")
                .accept()
                .unwrap();
            let ip = client.peer_addr().unwrap();
            // TODO separate connection logs from message transmission
            // logs
            println!("Connection from {}", ip);
            let mut connections = thread_connections.lock().unwrap();
            let (to_thread, from_main) = mpsc::channel();
            connections.push((ClientId(next_id), to_thread));
            let to_main_clone = to_main.clone();
            thread::spawn(move || {
                serve_client(
                    to_main_clone,
                    from_main,
                    client,
                    ClientId(next_id),
                );
            });
            next_id += 1;
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        match msg_from_client.update {
            Update::Disconnect => {
                let disconnecting_id = msg_from_client.client_id;
                let disconnecting_ix =
                    connections.iter().position(|&(c_id, _)| {
                        return c_id == disconnecting_id;
                    });
                assert!(disconnecting_ix.is_some());
                connections.swap_remove(disconnecting_ix.unwrap());
            }
            Update::State(_) => (),
        }
        for &(c_id, ref to_thread) in connections.iter() {
            if c_id == msg_from_client.client_id {
                continue;
            }
            // TODO: here we clone the client message every time. Can
            // this be done more efficiently?
            to_thread.send(msg_from_client.clone()).unwrap();
        }
    }
}
