#[macro_use]
extern crate serde_derive;

extern crate serde;
extern crate serde_json;
extern crate websocket;

use std::sync::{Mutex, Arc};
use std::sync::mpsc::{Sender, channel};
use std::thread;
use websocket::OwnedMessage;
use websocket::sync::Server;
use websocket::ws::Receiver;

#[derive(Serialize, Deserialize, Debug)]
struct Message {
    beats: Vec<bool>
}

fn main() {
    let server = Server::bind("127.0.0.1:2794").unwrap();
    let is_kick = Arc::new(Mutex::new(true));
    let connections : Arc<Mutex<Vec<(bool, Sender<String>)>>> =
        Arc::new(Mutex::new(Vec::new()));
    for request in server.filter_map(Result::ok) {
        let is_kick_rc = Arc::clone(&is_kick);
        let connections_rc = Arc::clone(&connections);
        thread::spawn(move || {
            if !request.protocols().contains(&"giogadi".to_string()) {
                request.reject().unwrap();
                return;
            }
            let mut client = request.use_protocol("giogadi").accept().unwrap();
            let ip = client.peer_addr().unwrap();
            println!("Connection from {}", ip);

            let (tx, rx) = channel();
            let is_kick = {
                let mut is_kick = is_kick_rc.lock().unwrap();
                let mut connections = connections_rc.lock().unwrap();
                connections.push((*is_kick, tx.clone()));
                let old_is_kick = *is_kick;
                *is_kick = !*is_kick;
                old_is_kick
            };
            let instrument = if is_kick { "Kick" } else { "Snare" };
            let message = OwnedMessage::Text(instrument.to_string());
            client.send_message(&message).unwrap();

            client.stream_ref().set_read_timeout(Some(std::time::Duration::new(1, 0))).ok();

            let (mut reader, mut sender) = client.split().unwrap();

            loop {
                let result = reader.receiver.recv_message(&mut reader.stream);
                match result {
                    Ok(OwnedMessage::Text(s)) => {
                        println!("{}", &s);
                        for &(c_is_kick, ref c_tx) in
                            connections_rc.lock().unwrap().iter() {
                                if c_is_kick == is_kick {
                                    continue;
                                }
                                c_tx.send(s.clone()).unwrap();
                            }
                    }
                    _ => {
                        // println!("{:?}", &result);
                    }
                }
                let result = rx.try_recv();
                match result {
                    Ok(s) => {
                        let message = OwnedMessage::Text(s);
                        sender.send_message(&message).ok();
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        println!("{:?}", &result);
                    }
                }
            }
        });
    }
}
