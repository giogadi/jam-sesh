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

type NoteIndex = i32;

#[derive(Serialize, Deserialize, Debug, Clone)]
struct State {
    synth_sequence: Vec<Vec<NoteIndex>>,
    drum_sequence: Vec<Vec<NoteIndex>>,
}
impl State {
    fn new(num_beats: usize) -> State {
        let mut state = State {
            synth_sequence: vec![vec![-1; 2]; num_beats],
            drum_sequence: vec![vec![-1; 2]; num_beats],
        };
        let default_note_ix = 24;
        for (ix, notes) in state.synth_sequence.iter_mut().enumerate() {
            if ix % 4 == 0 {
                notes[0] = default_note_ix;
            }
        }
        for (ix, notes) in state.drum_sequence.iter_mut().enumerate() {
            if ix % 4 == 0 {
                notes[0] = 0;
            }
        }
        state
    }
}

enum UpdateFromClient {
    NewState(State, ClientId),
    Disconnect(ClientId),
}

struct ClientInfo {
    id: ClientId,
    to_client_thread: mpsc::Sender<State>,
}

fn maybe_relay_update_from_main_to_client(
    from_main: &mpsc::Receiver<State>,
    to_client: &mut websocket::sender::Writer<std::net::TcpStream>) {
    let result = from_main.try_recv();
    match result {
        Ok(message_from_main) => {
            let json_msg = serde_json::to_string(&message_from_main).unwrap();
            println!("Sent {}", json_msg);
            to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
        }
        Err(std::sync::mpsc::TryRecvError::Empty) => (),
        Err(std::sync::mpsc::TryRecvError::Disconnected) => {
            println!("{:?}", &result);
        }
    }
}

// Returns true if client disconnected
fn maybe_relay_update_from_client_to_main(
    to_main: &mpsc::Sender<UpdateFromClient>,
    from_client: &mut websocket::receiver::Reader<std::net::TcpStream>,
    from_client_id: ClientId)
    -> bool {
    let result = from_client
        .receiver
        .recv_message(&mut from_client.stream);
    match result {
        Ok(OwnedMessage::Text(s)) => {
            // TODO separate logging
            println!("{} {}", from_client_id.0, &s);
            let state: State = serde_json::from_str(&s).unwrap();
            let update = UpdateFromClient::NewState(state, from_client_id);
            to_main.send(update).unwrap();
            return false;
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
                from_client_id.0, disconnect_string
            );
            let update = UpdateFromClient::Disconnect(from_client_id);
            to_main.send(update).unwrap();
            return true;
        }
        // TODO: handle each of these cases with more granularity. For
        // example, should distinguish "no data received" from
        // "received data that didn't fit in any of the above
        // categories".
        _ => {
            return false;
        }
    }
}

fn serve_client(
    to_main: mpsc::Sender<UpdateFromClient>,
    from_main: mpsc::Receiver<State>,
    client: websocket::sync::Client<std::net::TcpStream>,
    id: ClientId,
    current_state: State) {
    client
        .stream_ref()
        .set_read_timeout(Some(std::time::Duration::new(1, 0)))
        .ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
    // Send current_state to client
    {
        let json_msg = serde_json::to_string(&current_state).unwrap();
        to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
    }
    loop {
        let disconnected = maybe_relay_update_from_client_to_main(
            &to_main, &mut from_client, id);
        if disconnected {
            break;
        }
        maybe_relay_update_from_main_to_client(
            &from_main, &mut to_client);
    }
}

fn main() {
    const NUM_BEATS: usize = 16;
    let server = Server::bind("0.0.0.0:2795").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<ClientInfo>>> =
        Arc::new(Mutex::new(Vec::new()));
    let state: Arc<Mutex<State>> = Arc::new(Mutex::new(State::new(NUM_BEATS)));
    // TODO: I hate these names
    let thread_connections = Arc::clone(&connections);
    let thread_state = Arc::clone(&state);
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
            let id = ClientId(next_id);
            connections.push(ClientInfo {
                id: id,
                to_client_thread: to_thread,
            });
            let to_main_clone = to_main.clone();
            let state = thread_state.lock().unwrap().clone();
            thread::spawn(move || {
                serve_client(to_main_clone, from_main, client, id,
                             state);
            });
            next_id += 1;
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        let mut server_state = state.lock().unwrap();
        match msg_from_client {
            UpdateFromClient::NewState(state_from_client, from_client_id) => {
                // TODO: Make merging of different clients' states more
                // intelligent.
                *server_state = state_from_client;
                for client_info in connections.iter() {
                    if client_info.id == from_client_id {
                        continue;
                    }
                    client_info.to_client_thread.send(server_state.clone())
                        .unwrap();
                }
            }
            UpdateFromClient::Disconnect(disconnecting_id) => {
                let disconnecting_ix =
                    connections.iter().position(|client_info| {
                        return client_info.id == disconnecting_id;
                    });
                assert!(disconnecting_ix.is_some());
                connections.swap_remove(disconnecting_ix.unwrap());
            }
        }
    }
}
