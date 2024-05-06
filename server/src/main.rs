extern crate serde;
extern crate serde_json;
extern crate websocket;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use websocket::sync::Server;
use websocket::OwnedMessage;

use jam_sesh_server::*;

fn update_main_state_from_client(
    update: &RoomStateUpdateFromClient, state: &mut RoomState, connections: &mut Vec<ClientInfo>) {
    match &update.update {
        RoomStateUpdate::Connect {username} => {
            state.connected_clients.push((update.client_id,username.clone()));
        }
        RoomStateUpdate::Disconnect => {
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
        RoomStateUpdate::SynthSeq { synth_ix, beat_ix, active_cell_ixs, .. } => {
            let voices = &mut state.synth_sequences[*synth_ix as usize][*beat_ix as usize];
            assert!(voices.len() == active_cell_ixs.len(), "voices={:?}, active_cell_ixs={:?}", voices, active_cell_ixs);
            for (i,v) in active_cell_ixs.iter().enumerate() {
                voices[i] = *v;
            }
        }
        RoomStateUpdate::SamplerSeq { beat_ix, active_cell_ixs, .. } => {
            let voices = &mut state.sampler_sequence[*beat_ix as usize];
            assert!(voices.len() == active_cell_ixs.len());
            for (i,v) in active_cell_ixs.iter().enumerate() {
                voices[i] = *v;
            }
        }
        RoomStateUpdate::SynthFilterCutoff { synth_ix, value } => {
            state.synth_cutoffs[*synth_ix as usize] = *value;
        }
    }
}

fn listen_for_client_updates(
    to_main: mpsc::Sender<RoomStateUpdateFromClient>,
    mut from_client: websocket::receiver::Reader<std::net::TcpStream>,
    client_id: ClientId) {
    loop {
        let result = from_client.recv_message();
        let mut disconnect = false;
        let mut disconnect_reason = "".to_string();
        match result {
            Ok(OwnedMessage::Text(s)) => {
                println!("Received: {} {}", client_id.0, &s);
                let update: RoomStateUpdate = serde_json::from_str(&s).unwrap();
                to_main.send(RoomStateUpdateFromClient {
                    client_id: client_id.0,
                    update: update
                }).unwrap();
            }
            Ok(OwnedMessage::Close(maybe_close_data)) => {
                disconnect = true;
                disconnect_reason = match maybe_close_data {
                    Some(close_data) => close_data.reason,
                    None => "".to_string(),
                };
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
                disconnect = true;
                disconnect_reason = "no more data".to_string();
            }
        }
        if disconnect {
            println!(
                        "Client {} disconnected: {}",
                        client_id.0, disconnect_reason
                    );
                    to_main.send(RoomStateUpdateFromClient {
                        client_id: client_id.0,
                        update: RoomStateUpdate::Disconnect
                    }).unwrap();
                    // Stop this thread on disconnect
                    return;
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
    let state: Arc<Mutex<RoomState>> = Arc::new(Mutex::new(RoomState::new()));
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
                RoomStateUpdate::Connect {..} => true,
                RoomStateUpdate::Disconnect => true,
                _ => false
            };
            if !accept_msg {
                continue;
            }
        }

        update_main_state_from_client(&msg_from_client, &mut server_state, &mut connections);

        // If it was a connect message, send the state sync update directly to that client.
        // The client can assume that _they_ are the last item in connected_clients.
        if let RoomStateUpdate::Connect {..} = msg_from_client.update {
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
