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

#[derive(Serialize, Deserialize, Debug, Clone)]
struct State {
    synth_sequences: Vec<Vec<Vec<i32>>>,
    synth_cutoffs: Vec<f64>,
    sampler_sequence: Vec<Vec<i32>>,
    connected_clients: Vec<i32>
}
impl State {
    fn new() -> State {
        const NUM_SYNTHS: usize = 2;
        const NUM_BEATS: usize = 16;
        const NUM_ROWS: usize = 14;
        let mut state = State {
            synth_sequences: vec![vec![vec![0; NUM_BEATS]; NUM_ROWS]; NUM_SYNTHS],
            synth_cutoffs: vec![0.5; NUM_SYNTHS],
            sampler_sequence: vec![vec![0; NUM_BEATS]; 2],
            connected_clients: vec![]
        };
        state.synth_sequences[0][NUM_ROWS-1][0] = 1;
        state.synth_sequences[0][NUM_ROWS-1][4] = 1;
        state.synth_sequences[0][NUM_ROWS-1][8] = 1;
        state.synth_sequences[0][NUM_ROWS-1][12] = 1;
        state
    }
}

#[derive(Debug, Clone)]
enum ParsedUpdate {
    Connect,
    Disconnect,
    SynthSeq {
        synth_ix: usize,
        beat_ix: usize,
        cell_ix: usize,
        on: bool
    },
    SamplerSeq {
        beat_ix: usize,
        cell_ix: usize,
        on: bool
    },
    SynthFilterCutoff {
        synth_ix: usize,
        value: f64
    }
}

#[derive(Debug, Clone)]
struct ParsedAndOrigUpdateFromClient {
    parsed_update: ParsedUpdate,
    original_msg: String,
    client_id: ClientId
}

fn parse_msg_from_client(msg: &str) -> Option<ParsedUpdate> {
    let v: serde_json::Value = serde_json::from_str(msg).unwrap();
    let update_type = &v["update_type"];
    if update_type == "synth_seq" {
        return Option::Some(ParsedUpdate::SynthSeq {
            synth_ix: v["synth_ix"].as_i64().unwrap() as usize,
            beat_ix: v["beat_ix"].as_i64().unwrap() as usize,
            cell_ix: v["cell_ix"].as_i64().unwrap() as usize,
            on: v["on"].as_bool().unwrap()
        });
    } else if update_type == "sampler_seq" {
        return Option::Some(ParsedUpdate::SamplerSeq {
            beat_ix: v["beat_ix"].as_i64().unwrap() as usize,
            cell_ix: v["cell_ix"].as_i64().unwrap() as usize,
            on: v["on"].as_bool().unwrap()
        });
    } else if update_type == "filter_cutoff" {
        return Option::Some(ParsedUpdate::SynthFilterCutoff {
            synth_ix: v["synth_ix"].as_i64().unwrap() as usize,
            value: v["value"].as_f64().unwrap()
        })
    }
    return Option::None;
}

fn update_main_state_from_client(update: &ParsedAndOrigUpdateFromClient, state: &mut State, connections: &mut Vec<ClientInfo>) {
    match update.parsed_update {
        ParsedUpdate::Connect => {
            // state.connected_clients.push(update.client_id.0 as i32);
            // TODO: WHERE DO WE UPDATE state.connected_client_ids or whatever?!?!?!
            panic!("ParsedUpdate::Connect should never happen");
        }
        ParsedUpdate::Disconnect => {
            // TODO: can these 2 be the same list?

            // Remove from list of connections sent to clients
            let client_ix =
                state.connected_clients.iter().position(|&x| x == (update.client_id.0 as i32)).unwrap();
            state.connected_clients.swap_remove(client_ix);

            // Remove from main's master list of connections
            let disconnecting_ix =
                    connections.iter().position(|client_info| {
                        return client_info.id == update.client_id;
                    });
            assert!(disconnecting_ix.is_some());
            connections.swap_remove(disconnecting_ix.unwrap());
        }
        ParsedUpdate::SynthSeq { synth_ix, beat_ix, cell_ix, on } => {
            // TODO: do validation of voices.
            state.synth_sequences[synth_ix][cell_ix][beat_ix] = if on { 1 } else { 0 };
        }
        ParsedUpdate::SamplerSeq { beat_ix, cell_ix, on } => {
            state.sampler_sequence[cell_ix][beat_ix] = if on { 1 } else { 0 };
        }
        ParsedUpdate::SynthFilterCutoff { synth_ix, value } => {
            state.synth_cutoffs[synth_ix] = value;
        }
    }
}

#[derive(Debug, Clone)]
enum UpdateFromMain {
    FullStateSync(State),
    DiffUpdate(ParsedAndOrigUpdateFromClient)
}

struct ClientInfo {
    id: ClientId,
    to_client_thread: mpsc::Sender<UpdateFromMain>,
}

#[derive(Serialize)]
struct FullStateSyncPreJson {
    update_type: &'static str,
    state: State
}

#[derive(Serialize)]
struct NewConnectionPreJson {
    update_type: &'static str,
    client_id: i32
}

#[derive(Serialize)]
struct DisconnectPreJson {
    update_type: &'static str,
    client_id: i32
}

fn maybe_relay_update_from_main_to_client(
    from_main: &mpsc::Receiver<UpdateFromMain>,
    to_client: &mut websocket::sender::Writer<std::net::TcpStream>) {
    let result = from_main.try_recv();
    match result {
        Ok(UpdateFromMain::FullStateSync(state)) => {
            let pre_json_msg = FullStateSyncPreJson {
                update_type: "sync",
                state: state
            };
            let json_msg = serde_json::to_string(&pre_json_msg).unwrap();
            println!("Sent {}", json_msg);
            to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
        }
        Ok(UpdateFromMain::DiffUpdate(update)) => {
            println!("Sent {}", update.original_msg);
            to_client.send_message(&OwnedMessage::Text(update.original_msg)).unwrap();
        }
        Err(std::sync::mpsc::TryRecvError::Empty) => (),
        Err(std::sync::mpsc::TryRecvError::Disconnected) => {
            println!("{:?}", &result);
        }
    }
}

// Returns true if client disconnected
fn maybe_relay_update_from_client_to_main(
    to_main: &mpsc::Sender<ParsedAndOrigUpdateFromClient>,
    from_client: &mut websocket::receiver::Reader<std::net::TcpStream>,
    from_client_id: ClientId)
    -> bool {
    let result = from_client
        .receiver
        .recv_message(&mut from_client.stream);
    match result {
        Ok(OwnedMessage::Text(s)) => {
            println!("Received: {} {}", from_client_id.0, &s);
            let parsed_update = parse_msg_from_client(&s).unwrap();
            to_main.send(ParsedAndOrigUpdateFromClient {
                parsed_update: parsed_update,
                original_msg: s,
                client_id: from_client_id
            }).unwrap();
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
            let pre_json = DisconnectPreJson {
                update_type: "disconnect",
                client_id: from_client_id.0 as i32
            };
            let update = ParsedAndOrigUpdateFromClient {
                parsed_update: ParsedUpdate::Disconnect,
                original_msg: serde_json::to_string(&pre_json).unwrap(),
                client_id: from_client_id
            };
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
    to_main: mpsc::Sender<ParsedAndOrigUpdateFromClient>,
    from_main: mpsc::Receiver<UpdateFromMain>,
    client: websocket::sync::Client<std::net::TcpStream>,
    id: ClientId) {
    client
        .stream_ref()
        .set_read_timeout(Some(std::time::Duration::new(1, 0)))
        .ok();
    let (mut from_client, mut to_client) = client.split().unwrap();
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
    let server = Server::bind("0.0.0.0:2795").unwrap();
    let (to_main, from_threads) = mpsc::channel();
    let connections: Arc<Mutex<Vec<ClientInfo>>> =
        Arc::new(Mutex::new(Vec::new()));
    let state: Arc<Mutex<State>> = Arc::new(Mutex::new(State::new()));
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
            thread::spawn(move || {
                serve_client(to_main_clone, from_main, client, id);
            });
            // Construct the connect message we'll use. 
            let pre_json_msg = NewConnectionPreJson {
                update_type: "new_client",
                client_id: id.0 as i32
            };
            let new_connect_msg = serde_json::to_string(&pre_json_msg).unwrap();
            let msg_to_client = UpdateFromMain::DiffUpdate(ParsedAndOrigUpdateFromClient {
                parsed_update: ParsedUpdate::Connect,
                original_msg: new_connect_msg,
                client_id: id
            });
            // Send the connect message to EVERYONE and then send the state message to the new client
            for client_info in connections.iter() {
                client_info.to_client_thread.send(msg_to_client.clone()).unwrap();
            }

            // NOW send the state to the new client
            let mut state = thread_state.lock().unwrap();
            state.connected_clients.push(id.0 as i32);
            let msg_to_client = UpdateFromMain::FullStateSync(state.clone());
            connections.last().unwrap().to_client_thread.send(msg_to_client).unwrap();

            next_id += 1;
        }
    });

    for msg_from_client in from_threads.iter() {
        let mut connections = connections.lock().unwrap();
        let mut server_state = state.lock().unwrap();
        update_main_state_from_client(&msg_from_client, &mut server_state, &mut connections);
        // Now send the update to all the clients
        for client_info in connections.iter() {
            if client_info.id == msg_from_client.client_id {
                continue;
            }
            client_info.to_client_thread.send(
                UpdateFromMain::DiffUpdate(msg_from_client.clone()))
                .unwrap();
        }
    }
}
