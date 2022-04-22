use websocket::sync::Server;
use websocket::OwnedMessage;
use std::thread;

use jam_sesh_server::*;

fn get_update_from_client(
    from_client: &mut websocket::receiver::Reader<std::net::TcpStream>,
    client_id: ClientId) -> Option<StateUpdateFromClient> {
    let result = from_client.recv_message();
    match result {
        Ok(OwnedMessage::Text(s)) => {
            println!("Received: {} {}", client_id.0, &s);
            let update: StateUpdate = serde_json::from_str(&s).unwrap();
            return Some(StateUpdateFromClient {
                client_id: client_id.0,
                update: update
            })
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
            return Some(StateUpdateFromClient {
                client_id: client_id.0,
                update: StateUpdate::Disconnect
            });
        }
        Ok(_) => {
            println!("Client listener: unexpected message");
            return None;
        }
        // TODO: handle each of these cases with more granularity. For
        // example, should distinguish "no data received" from
        // "received data that didn't fit in any of the above
        // categories".
        Err(e) => {
            println!("Client listener error: {}", e);
            return None;
        }
    }
}

fn update_main_state_from_client(
    update: &StateUpdateFromClient, state: &mut State
    // , connections: &mut Vec<ClientInfo>
) {
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
            // let disconnecting_ix =
            //         connections.iter().position(|client_info| {
            //             return client_info.id.0 == update.client_id;
            //         });
            // assert!(disconnecting_ix.is_some());
            // connections.swap_remove(disconnecting_ix.unwrap());
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

fn send_client_update(
    update: &StateUpdateFromClient,
    to_client: &mut websocket::sender::Writer<std::net::TcpStream>) {
    let json_msg = serde_json::to_string(update).unwrap();        
    println!("Sending {}", json_msg);
    to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();
}

fn main() {
    let server = Server::bind("0.0.0.0:2795").unwrap();
    thread::spawn(move || {
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
            
            let (mut from_client, mut to_client) = client.split().unwrap();

            let fake_user_id = ClientId(0);
            let test_client_id = ClientId(1);

            let mut state = State::new();
            
            // Let's start by adding a fake user who connected before the client we're testing.
            state.connected_clients.push((fake_user_id.0, String::from("alice")));

            // We first expect the connect message with the username, right?
            let username_update = get_update_from_client(&mut from_client, test_client_id).unwrap();

            update_main_state_from_client(&username_update, &mut state);

            // Now we send the state, right?
            let json_msg = serde_json::to_string(&state).unwrap();
            println!("Sending {}", json_msg);
            to_client.send_message(&OwnedMessage::Text(json_msg)).unwrap();

            // Got an update. Now we make a small change to it and send it back.
            let update_from_client = get_update_from_client(&mut from_client, test_client_id).unwrap();

            let mut mock_update = update_from_client.clone();
            mock_update.client_id = fake_user_id.0;
            match &mut mock_update.update {
                StateUpdate::SynthSeq {active_cell_ixs, ..} => {
                    active_cell_ixs[0] += 1;
                }
                StateUpdate::SamplerSeq { active_cell_ixs, ..} => {
                    active_cell_ixs[0] += 1;
                }
                StateUpdate::SynthFilterCutoff { value, ..} => {
                    *value += 0.1;
                }
                _ => {

                }
            }

            // let synth_seq = get_update_from_client(&mut from_client, test_client_id).unwrap();

            // let mut mock_synth_seq = synth_seq.clone();
            // mock_synth_seq.client_id = fake_user_id.0;
            // if let StateUpdate::SynthSeq {active_cell_ixs, ..} = &mut mock_synth_seq.update {
            //     active_cell_ixs[0] += 1;
            // }

            send_client_update(&mock_update, &mut to_client);

            // Now send the client's original message back to the client
            send_client_update(&update_from_client, &mut to_client);
        }
    });
    loop
    {}
}