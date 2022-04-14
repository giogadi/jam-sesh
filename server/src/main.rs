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
struct ClientId(usize);

#[derive(Serialize, Deserialize, Debug, Clone)]
struct State {
    synth_sequences: Vec<Vec<Vec<i32>>>,
    synth_cutoffs: Vec<f64>,
    sampler_sequence: Vec<Vec<i32>>,
    connected_clients: Vec<(i32,String)>
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
    Connect {
        username: String
    },
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
    } else if update_type == "new_client" {
        return Option::Some(ParsedUpdate::Connect {
            username: String::from(v["username"].as_str().unwrap())
        });
    } else if update_type == "disconnect" {
        return Option::Some(ParsedUpdate::Disconnect);
    }
    return Option::None;
}

fn update_main_state_from_client(
    update: &ParsedAndOrigUpdateFromClient, state: &mut State, connections: &mut Vec<ClientInfo>) {
    match &update.parsed_update {
        ParsedUpdate::Connect {username} => {
            state.connected_clients.push((update.client_id.0 as i32,username.clone()));
        }
        ParsedUpdate::Disconnect => {
            // TODO: can these 2 be the same list?

            // Remove from list of connections sent to clients
            let client_ix =
                state.connected_clients.iter().position(|&(id,_)| id == (update.client_id.0 as i32));
            if client_ix.is_some() {
                state.connected_clients.swap_remove(client_ix.unwrap());
            } else {
                println!("Client {} disconnected before sending a username.", update.client_id.0);
            }

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
            state.synth_sequences[*synth_ix][*cell_ix][*beat_ix] = if *on { 1 } else { 0 };
        }
        ParsedUpdate::SamplerSeq { beat_ix, cell_ix, on } => {
            state.sampler_sequence[*cell_ix][*beat_ix] = if *on { 1 } else { 0 };
        }
        ParsedUpdate::SynthFilterCutoff { synth_ix, value } => {
            state.synth_cutoffs[*synth_ix] = *value;
        }
    }
}

fn listen_for_client_updates(
    to_main: mpsc::Sender<ParsedAndOrigUpdateFromClient>,
    mut from_client: websocket::receiver::Reader<std::net::TcpStream>,
    client_id: ClientId) {
    loop {
        let result = from_client.recv_message();
        match result {
            Ok(OwnedMessage::Text(s)) => {
                println!("Received: {} {}", client_id.0, &s);
                let parsed_update = parse_msg_from_client(&s).unwrap();
                let orig_msg: String;
                if let ParsedUpdate::Connect {username} = &parsed_update {
                    // Construct the connect message we'll use (with client ID attached)
                    let pre_json_msg = NewConnectionPreJson {
                        update_type: "new_client",
                        client_id: client_id.0 as i32,
                        username: username.clone()
                    };
                    orig_msg = serde_json::to_string(&pre_json_msg).unwrap();
                } else {
                    orig_msg = s;
                }
                to_main.send(ParsedAndOrigUpdateFromClient {
                    parsed_update: parsed_update,
                    original_msg: orig_msg,
                    client_id: client_id
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
                let pre_json = DisconnectPreJson {
                    update_type: "disconnect",
                    client_id: client_id.0 as i32
                };
                let update = ParsedAndOrigUpdateFromClient {
                    parsed_update: ParsedUpdate::Disconnect,
                    original_msg: serde_json::to_string(&pre_json).unwrap(),
                    client_id: client_id
                };
                to_main.send(update).unwrap();
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

#[derive(Serialize)]
struct FullStateSyncPreJson {
    update_type: &'static str,
    state: State
}

#[derive(Serialize)]
struct NewConnectionPreJson {
    update_type: &'static str,
    client_id: i32,
    username: String
}

#[derive(Serialize)]
struct DisconnectPreJson {
    update_type: &'static str,
    client_id: i32
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
            |c| c.id == msg_from_client.client_id).unwrap();
        if !source_client.sent_state_sync {
            let accept_msg = match msg_from_client.parsed_update {
                ParsedUpdate::Connect {..} => true,
                ParsedUpdate::Disconnect => true,
                _ => false
            };
            if !accept_msg {
                continue;
            }
        }

        update_main_state_from_client(&msg_from_client, &mut server_state, &mut connections);

        // If it was a connect message, send the state sync update directly to that client.
        // The client can assume that _they_ are the last item in connected_clients.
        if let ParsedUpdate::Connect {..} = msg_from_client.parsed_update {
            let new_client = connections.iter_mut().find(
                |c| c.id == msg_from_client.client_id).unwrap();
            new_client.received_username = true;
            let pre_json_msg = FullStateSyncPreJson {
                update_type: "sync",
                state: server_state.clone()
            };
            let json_msg = serde_json::to_string(&pre_json_msg).unwrap();
            println!("Sending {}", json_msg);
            new_client.to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
            new_client.sent_state_sync = true;
        }

        // Now send the update to all the clients.
        for client_info in connections.iter_mut() {
            if !client_info.sent_state_sync {
                // If this client has not yet received its state sync, we do not
                // send them any other messages.
                continue;
            }    
            // TODO: do I have to copy this string?
            client_info.to_client.send_message(
                &OwnedMessage::Text(msg_from_client.original_msg.clone())).unwrap();          
        }
    }
}
