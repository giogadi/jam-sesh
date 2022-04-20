#[macro_use]
extern crate serde_derive;

extern crate serde;
extern crate serde_json;
extern crate websocket;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use websocket::sync::Server;
use websocket::OwnedMessage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ClientId(i32);

#[derive(Serialize, Deserialize, Debug, Clone)]
struct State {
    num_synth_note_rows: i32,
    num_sampler_note_rows: i32,
    synth_sequences: Vec<Vec<Vec<i32>>>,
    synth_cutoffs: Vec<f64>,
    sampler_sequence: Vec<Vec<i32>>,
    connected_clients: Vec<(i32,String)>
}
impl State {
    fn new() -> State {
        const NUM_SYNTHS: usize = 2;
        const NUM_BEATS: usize = 16;
        const NUM_SYNTH_VOICES_0: usize = 2;
        const NUM_SYNTH_VOICES_1: usize = 1;
        const NUM_SAMPLER_VOICES: usize = 2;
        const NUM_SYNTH_NOTE_ROWS: usize = 14;
        const NUM_SAMPLER_NOTE_ROWS: usize = 2;
        let synth_sequence0 = vec![vec![-1; NUM_SYNTH_VOICES_0]; NUM_BEATS];
        let synth_sequence1 = vec![vec![-1; NUM_SYNTH_VOICES_1]; NUM_BEATS];
        let mut state = State {
            num_synth_note_rows: NUM_SYNTH_NOTE_ROWS as i32,
            num_sampler_note_rows: NUM_SAMPLER_NOTE_ROWS as i32,
            synth_sequences: vec![synth_sequence0, synth_sequence1],
            synth_cutoffs: vec![0.5; NUM_SYNTHS],
            sampler_sequence: vec![vec![-1; NUM_SAMPLER_VOICES]; NUM_BEATS],
            connected_clients: vec![]
        };
        state.synth_sequences[0][0][0] = (NUM_SYNTH_NOTE_ROWS-1) as i32;
        state.synth_sequences[0][4][0] = (NUM_SYNTH_NOTE_ROWS-1) as i32;
        state.synth_sequences[0][8][0] = (NUM_SYNTH_NOTE_ROWS-1) as i32;
        state.synth_sequences[0][12][0] = (NUM_SYNTH_NOTE_ROWS-1) as i32;
        state
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
enum StateUpdate {
    Connect {
        username: String
    },
    Disconnect,
    SynthSeq {
        synth_ix: i32,
        beat_ix: i32,
        active_cell_ixs: Vec<i32>,
        clicked_cell_ix: i32
    },
    SamplerSeq {
        beat_ix: i32,
        active_cell_ixs: Vec<i32>,
        clicked_cell_ix: i32
    },
    SynthFilterCutoff {
        synth_ix: i32,
        value: f64
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct StateUpdateFromClient {
    client_id: i32,
    update: StateUpdate
}

fn update_main_state_from_client(
    update: &StateUpdateFromClient, state: &mut State, connections: &mut Vec<ClientInfo>) {
    match &update.update {
        StateUpdate::Connect {username} => {
            state.connected_clients.push((update.client_id,username.clone()));
        }
        StateUpdate::Disconnect => {
            // TODO: can these 2 be the same list?

            // Remove from list of connections sent to clients
            let client_ix =
                state.connected_clients.iter().position(|&(id,_)| id == (update.client_id));
            if client_ix.is_some() {
                state.connected_clients.swap_remove(client_ix.unwrap());
            } else {
                println!("Client {} disconnected before sending a username.", update.client_id);
            }

            // Remove from main's master list of connections
            let disconnecting_ix =
                    connections.iter().position(|client_info| {
                        return client_info.id.0 == update.client_id;
                    });
            assert!(disconnecting_ix.is_some());
            connections.swap_remove(disconnecting_ix.unwrap());
        }
        StateUpdate::SynthSeq { synth_ix, beat_ix, active_cell_ixs, .. } => {
            let voices = &mut state.synth_sequences[*synth_ix as usize][*beat_ix as usize];
            assert!(voices.len() == active_cell_ixs.len(), "voices={:?}, active_cell_ixs={:?}", voices, active_cell_ixs);
            for (i,v) in active_cell_ixs.iter().enumerate() {
                voices[i] = *v;
            }
        }
        StateUpdate::SamplerSeq { beat_ix, active_cell_ixs, .. } => {
            let voices = &mut state.sampler_sequence[*beat_ix as usize];
            assert!(voices.len() == active_cell_ixs.len());
            for (i,v) in active_cell_ixs.iter().enumerate() {
                voices[i] = *v;
            }
        }
        StateUpdate::SynthFilterCutoff { synth_ix, value } => {
            state.synth_cutoffs[*synth_ix as usize] = *value;
        }
    }
}

fn listen_for_client_updates(
    to_main: mpsc::Sender<StateUpdateFromClient>,
    mut from_client: websocket::receiver::Reader<std::net::TcpStream>,
    client_id: ClientId) {
    loop {
        let result = from_client.recv_message();
        match result {
            Ok(OwnedMessage::Text(s)) => {
                println!("Received: {} {}", client_id.0, &s);
                let update: StateUpdate = serde_json::from_str(&s).unwrap();
                to_main.send(StateUpdateFromClient {
                    client_id: client_id.0,
                    update: update
                }).unwrap();
            }
            Ok(OwnedMessage::Close(maybe_close_data)) => {
                let disconnect_string = match maybe_close_data {
                    Some(close_data) => close_data.reason,
                    None => "".to_string(),
                };
                println!(
                    "Client {} disconnected: {}",
                    client_id.0, disconnect_string
                );
                to_main.send(StateUpdateFromClient {
                    client_id: client_id.0,
                    update: StateUpdate::Disconnect
                }).unwrap();
                // Stop this thread on disconnect
                return;
            }
            Ok(_) => {
                println!("Client listener: unexpected message");
            }
            // TODO: handle each of these cases with more granularity. For
            // example, should distinguish "no data received" from
            // "received data that didn't fit in any of the above
            // categories".
            Err(e) => {
                println!("Client listener error: {}", e);
            }
        }
    }
}

struct ClientInfo {
    id: ClientId,
    to_client: websocket::sender::Writer<std::net::TcpStream>,
    received_username: bool,
    sent_state_sync: bool
}

fn main() {
    let server = Server::bind("0.0.0.0:2795").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<ClientInfo>>> =
        Arc::new(Mutex::new(Vec::new()));
    let state: Arc<Mutex<State>> = Arc::new(Mutex::new(State::new()));
    // TODO: I hate these names
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
            client
                .stream_ref()
                .set_read_timeout(None)
                .ok();
            let (from_client, to_client) = client.split().unwrap();
            let mut connections = thread_connections.lock().unwrap();
            // let (to_thread, from_main) = mpsc::channel();
            let id = ClientId(next_id);
            connections.push(ClientInfo {
                id: id,
                to_client: to_client,
                received_username: false,
                sent_state_sync: false
            });

            let to_main_clone = to_main.clone();
            thread::spawn(move || {
                listen_for_client_updates(to_main_clone, from_client, id);
            });

            next_id += 1;
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        let mut server_state = state.lock().unwrap();

        // If this message came from a client that has not received a state sync
        // update yet, we only accept connect/disconnect updates.
        let source_client = connections.iter_mut().find(
            |c| c.id.0 == msg_from_client.client_id).unwrap();
        if !source_client.sent_state_sync {
            let accept_msg = match msg_from_client.update {
                StateUpdate::Connect {..} => true,
                StateUpdate::Disconnect => true,
                _ => false
            };
            if !accept_msg {
                continue;
            }
        }

        update_main_state_from_client(&msg_from_client, &mut server_state, &mut connections);

        // If it was a connect message, send the state sync update directly to that client.
        // The client can assume that _they_ are the last item in connected_clients.
        if let StateUpdate::Connect {..} = msg_from_client.update {
            // We recompute the source client because its location could have
            // potentially changed in the above state update
            let source_client = connections.iter_mut().find(
                |c| c.id.0 == msg_from_client.client_id).unwrap();
            source_client.received_username = true;
            let json_msg = serde_json::to_string(&*server_state).unwrap();
            println!("Sending {}", json_msg);
            source_client.to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
            source_client.sent_state_sync = true;
        }

        // Now send the update to all the clients.
        let json_msg = serde_json::to_string(&msg_from_client).unwrap();
        for client_info in connections.iter_mut() {
            if !client_info.sent_state_sync {
                // If this client has not yet received its state sync, we do not
                // send them any other messages.
                continue;
            }    
            // TODO: do I have to copy this string?
            client_info.to_client.send_message(
                &OwnedMessage::Text(json_msg.clone())).unwrap();          
        }
    }
}
