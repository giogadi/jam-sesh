#[macro_use]
extern crate serde_derive;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientId(pub i32);

pub struct SynthParam {
    pub default_value: f64
}

const NUM_SYNTH_PARAMS: usize = 2;
const SYNTH_PARAMS: [SynthParam; 2] = [
    SynthParam { default_value: 6000.0 },
    SynthParam { default_value: 0.005 }
];

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomState {
    pub num_synth_note_rows: i32,
    pub num_sampler_note_rows: i32,
    pub synth_sequences: Vec<Vec<Vec<i32>>>,
    pub synth_params: Vec<Vec<f64>>,
    pub sampler_sequence: Vec<Vec<i32>>,
    pub connected_clients: Vec<(i32,String)>
}
impl RoomState {
    pub fn new() -> RoomState {
        const NUM_SYNTHS: usize = 2;
        const NUM_BEATS: usize = 16;
        const NUM_SYNTH_VOICES_0: usize = 2;
        const NUM_SYNTH_VOICES_1: usize = 1;
        const NUM_SAMPLER_VOICES: usize = 2;
        const NUM_SYNTH_NOTE_ROWS: usize = 14;
        const NUM_SAMPLER_NOTE_ROWS: usize = 2;
        let synth_sequence0 = vec![vec![-1; NUM_SYNTH_VOICES_0]; NUM_BEATS];
        let synth_sequence1 = vec![vec![-1; NUM_SYNTH_VOICES_1]; NUM_BEATS];
        let mut state = RoomState {
            num_synth_note_rows: NUM_SYNTH_NOTE_ROWS as i32,
            num_sampler_note_rows: NUM_SAMPLER_NOTE_ROWS as i32,
            synth_sequences: vec![synth_sequence0, synth_sequence1],
            synth_params: vec![vec![0.0; NUM_SYNTH_PARAMS]; NUM_SYNTHS],
            sampler_sequence: vec![vec![-1; NUM_SAMPLER_VOICES]; NUM_BEATS],
            connected_clients: vec![]
        };
        state.synth_sequences[0][0][0] = 60 as i32;
        state.synth_sequences[0][4][0] = 60 as i32;
        state.synth_sequences[0][8][0] = 60 as i32;
        state.synth_sequences[0][12][0] = 60 as i32;
        for synth_ix in 0..NUM_SYNTHS {
            for param_ix in 0..NUM_SYNTH_PARAMS {
                state.synth_params[synth_ix][param_ix] = SYNTH_PARAMS[param_ix].default_value; 
            }
        }
        state
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum RoomStateUpdate {
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
    SynthParam {
        synth_ix: i32,
        param_ix: i32,
        value: f64
    } 
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RoomStateUpdateFromClient {
    pub client_id: i32,
    pub update: RoomStateUpdate
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomId(pub i32);

