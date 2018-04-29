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
struct ClientState {
    sequence: Vec<NoteIndex>,  // TODO: maybe u8 or something?
    instrument: String,
}
impl ClientState {
    fn new(num_beats: u32, instrument: String) -> ClientState {
        let mut sequence = vec![-1; num_beats as usize];
        for (ix, beat) in sequence.iter_mut().enumerate() {
            *beat = if ix % 4 == 0 { 0 } else { -1 }
        }
        ClientState {
            sequence: sequence,
            instrument: instrument,
        }
    }
}

#[derive(Debug, Clone)]
enum Update {
    State(ClientState),
    Disconnect,
}

#[derive(Debug, Clone)]
struct ClientUpdate {
    client_id: ClientId,
    update: Update,
}

fn maybe_relay_update_from_client_to_main(
    to_main: &mpsc::Sender<ClientUpdate>,
    from_client: &mut websocket::receiver::Reader<std::net::TcpStream>,
    from_client_id: ClientId,
) -> Option<ClientUpdate> {
    let result = from_client
        .receiver
        .recv_message(&mut from_client.stream);
    match result {
        Ok(OwnedMessage::Text(s)) => {
            // TODO separate logging
            println!("{} {}", from_client_id.0, &s);
            let update_to_other_clients = ClientUpdate {
                client_id: from_client_id,
                update: Update::State(serde_json::from_str(&s).unwrap()),
            };
            to_main
                .send(update_to_other_clients.clone())
                .unwrap();
            return Some(update_to_other_clients);
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
            let update_to_other_clients = ClientUpdate {
                client_id: from_client_id,
                update: Update::Disconnect,
            };
            to_main
                .send(update_to_other_clients.clone())
                .unwrap();
            return Some(update_to_other_clients);
        }
        // TODO: handle each of these cases with more granularity. For
        // example, should distinguish "no data received" from
        // "received data that didn't fit in any of the above
        // categories".
        _ => {
            return None;
        }
    }
}

fn maybe_relay_update_from_main_to_client(
    from_main: &mpsc::Receiver<ClientUpdate>,
    to_client: &mut websocket::sender::Writer<std::net::TcpStream>,
    to_client_id: ClientId,
) {
    #[derive(Serialize, Deserialize, Debug)]
    struct MessageOutToClient {
        client_id: usize,
        update_type: String, // Can be "state" or "disconnect"
        client_state: ClientState,
    }
    let result = from_main.try_recv();
    match result {
        Ok(message_from_main) => {
            assert_ne!(message_from_main.client_id, to_client_id);
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
                    client_state: ClientState {
                        sequence: vec![],
                        instrument: "".to_string(),
                    },
                },
            };
            let json_msg = serde_json::to_string(&message_to_client).unwrap();
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

fn send_intro_message_to_client(
    to_client: &mut websocket::sender::Writer<std::net::TcpStream>,
    to_client_id: ClientId,
    current_client_states: Vec<(ClientId, ClientState)>,
) {
    #[derive(Serialize)]
    struct ClientIdAndStateMessage {
        client_id: usize,
        sequence: Vec<NoteIndex>,
        instrument: String,
    }

    #[derive(Serialize)]
    struct IntroMessageToClient {
        update_type: String, // should only be "intro"
        client_states: Vec<ClientIdAndStateMessage>,
        client_id: usize,
    }

    let mut all_state_message = IntroMessageToClient {
        update_type: "intro".to_string(),
        client_states: vec![],
        client_id: to_client_id.0,
    };
    for (c_id, state) in current_client_states {
        all_state_message
            .client_states
            .push(ClientIdAndStateMessage {
                client_id: c_id.0,
                sequence: state.sequence,
                instrument: state.instrument,
            });
    }
    let all_state_message = all_state_message;
    let json_msg = serde_json::to_string(&all_state_message).unwrap();
    to_client
        .send_message(&OwnedMessage::Text(json_msg))
        .unwrap();
}

fn serve_client(
    to_main: mpsc::Sender<ClientUpdate>,
    from_main: mpsc::Receiver<ClientUpdate>,
    client: websocket::sync::Client<std::net::TcpStream>,
    id: ClientId,
    current_client_states: Vec<(ClientId, ClientState)>,
) {
    client
        .stream_ref()
        .set_read_timeout(Some(std::time::Duration::new(1, 0)))
        .ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
    send_intro_message_to_client(&mut to_client, id, current_client_states);
    loop {
        let update_from_client = maybe_relay_update_from_client_to_main(
            &to_main,
            &mut from_client,
            id,
        );
        // If the client disconnected, break out of this loop and end
        // this thread.
        if let Some(update_from_client) = update_from_client {
            if let Update::Disconnect = update_from_client.update {
                break;
            }
        }
        maybe_relay_update_from_main_to_client(&from_main, &mut to_client, id);
    }
}

struct ClientInfo {
    id: ClientId,
    to_client_thread: mpsc::Sender<ClientUpdate>,
    state: ClientState,
}

fn main() {
    const NUM_BEATS: u32 = 16;
    let server = Server::bind("0.0.0.0:2795").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<ClientInfo>>> =
        Arc::new(Mutex::new(Vec::new()));
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
            let new_client_state =
                ClientState::new(NUM_BEATS, "kick".to_string());
            connections.push(ClientInfo {
                id: ClientId(next_id),
                to_client_thread: to_thread,
                state: new_client_state.clone(),
            });
            let to_main_clone = to_main.clone();
            let current_client_states = connections
                .iter()
                .map(|client_info| (client_info.id, client_info.state.clone()))
                .collect();
            thread::spawn(move || {
                serve_client(
                    to_main_clone,
                    from_main,
                    client,
                    ClientId(next_id),
                    current_client_states,
                );
            });
            let new_client_message = ClientUpdate {
                client_id: ClientId(next_id),
                update: Update::State(new_client_state),
            };
            for client_info in connections.iter() {
                if client_info.id == ClientId(next_id) {
                    continue;
                }
                client_info
                    .to_client_thread
                    .send(new_client_message.clone())
                    .unwrap();
            }
            next_id += 1;
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        match msg_from_client.update {
            Update::Disconnect => {
                let disconnecting_id = msg_from_client.client_id;
                let disconnecting_ix =
                    connections.iter().position(|client_info| {
                        return client_info.id == disconnecting_id;
                    });
                assert!(disconnecting_ix.is_some());
                connections.swap_remove(disconnecting_ix.unwrap());
            }
            Update::State(_) => (),
        }
        for client_info in connections.iter_mut() {
            if client_info.id == msg_from_client.client_id {
                match msg_from_client.update {
                    Update::Disconnect => {
                        // TODO: throw an error
                    }
                    Update::State(ref client_state) => {
                        client_info.state.sequence =
                            client_state.sequence.clone();
                        client_info.state.instrument =
                            client_state.instrument.clone();
                    }
                }
                continue;
            }
            // TODO: here we clone the client message every time. Can
            // this be done more efficiently?
            client_info
                .to_client_thread
                .send(msg_from_client.clone())
                .unwrap();
        }
    }
}
