#[macro_use]
extern crate serde_derive;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientId(pub i32);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct State {
    pub num_synth_note_rows: i32,
    pub num_sampler_note_rows: i32,
    pub synth_sequences: Vec<Vec<Vec<i32>>>,
    pub synth_cutoffs: Vec<f64>,
    pub sampler_sequence: Vec<Vec<i32>>,
    pub connected_clients: Vec<(i32,String)>
}
impl State {
    pub fn new() -> State {
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
pub enum StateUpdate {
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
pub struct StateUpdateFromClient {
    pub client_id: i32,
    pub update: StateUpdate
}