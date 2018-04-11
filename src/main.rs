extern crate websocket;

use std::sync::{Mutex, Arc};
use std::sync::mpsc;
use std::thread;
use websocket::OwnedMessage;
use websocket::sync::Server;
use websocket::ws::Receiver;

#[derive(Debug,Clone)]
struct Message {
    from_id: usize,
    data: String
}

fn serve_client(to_main: mpsc::Sender<Message>,
                from_main: mpsc::Receiver<Message>,
                client: websocket::sync::Client<std::net::TcpStream>,
                id: usize) {
    client.stream_ref().set_read_timeout(
        Some(std::time::Duration::new(1, 0))).ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
    loop {
        let result = from_client.receiver.recv_message(&mut from_client.stream);
        match result {
            Ok(OwnedMessage::Text(s)) => {
                // TODO separate logging
                println!("{} {}", id, &s);
                let to_main_message = Message {
                    from_id: id,
                    data: s
                };
                to_main.send(to_main_message).unwrap();
            }
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
    let server = Server::bind("127.0.0.1:2794").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<(usize, mpsc::Sender<Message>)>>> =
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
            let new_id = connections.len();
            let (to_thread, from_main) = mpsc::channel();
            connections.push((new_id, to_thread));
            let to_main_clone = to_main.clone();
            thread::spawn(move || {
                serve_client(to_main_clone, from_main, client, new_id);
            });
        }
    });

    for msg in from_threads.iter() {
        let connections = connections.lock().unwrap();
        for &(c_id, ref to_thread) in connections.iter() {
            if msg.from_id == c_id {
                continue;
            }
            to_thread.send(msg.clone()).unwrap();
        }
    }
}
