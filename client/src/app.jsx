'use strict';

import * as sound from './sound.js'

const CLIENT_COLORS = ['cyan', 'magenta', 'orange', 'lightblue', 'navy', 'purple', 'aquamarine', 'darkgreen'];
const CLIENT_COLORS_TEXT = ['black', 'black', 'black', 'black', 'white', 'white', 'blac', 'white'];


class SequencerTable extends React.Component {
  constructor(props) {
    super(props);
    this.tableContainer = React.createRef();
  }

  componentDidMount() {
    this.tableContainer.current.scrollTop = this.tableContainer.current.scrollHeight;
  }

  render() {
    let numRows = this.props.setting.length;
    let numColumns = this.props.setting[0].length;
    let rows = [];
    for (let i = 0; i < numRows; ++i) {
      rows.push(i);
    }
    let columns = [];
    for (let i = 0; i < numColumns; ++i) {
      columns.push(i);
    }

    let getButtonClass = (r,c, beatIx) => {
      const onBeat = beatIx == c;
      let className = this.props.setting[r][c] ?
        "sequencerCell sequencerCellActive" :
        "sequencerCell sequencerCellInactive";
      if (onBeat) {
        className += "OnBeat";
      }
      let highlights = this.props.userHighlights;
      for (let i = 0; i < highlights.length; ++i) {
        if (highlights[i].row === r && highlights[i].col === c) {
          className += " highlightCell";
          break;
        }
      }
      return className;
    };

    let getButtonStyle = (r,c) => {
      let highlights = this.props.userHighlights;
      for (let i = 0; i < highlights.length; ++i) {
        if (highlights[i].row === r && highlights[i].col === c) {
           return { borderColor: CLIENT_COLORS[highlights[i].id % CLIENT_COLORS.length] };
        }
      }
      return {};
    };

    return (
      <div className="tableContainer" ref={this.tableContainer}>
        <table className="sequencerTable">
          <tbody>
            { rows.map((r) =>
                <tr key={r.toString()}>
                  <th>{this.props.seqRowHeaders[r]}</th>
                  { columns.map((c) =>
                    <td className="sequencerTd" key={c.toString()}>
                      {
                        <button style={getButtonStyle(r,c)} className={getButtonClass(r,c,this.props.beatIx)} 
                          onClick={() => this.props.onClick(r,c)}
                        />
                      }
                    </td>)}
                </tr>)}
          </tbody>
        </table>
      </div>
    );
  }
}

class SynthComponent extends React.Component {
  constructor(props) {
    super(props);
    this.cutoffInput = React.createRef();
  }

  componentDidMount() {
    // This uses the typical DOM's onchange event instead of React's. We want
    // "only send an event after user lets go of control", which React's version
    // does not do.
    this.cutoffInput.current.onchange = ((e) => this.props.onCutoffGlobalUpdate(e.target.value));
  }
  
  render() {
    let sliderStyle = {};
    let sliderClass = "filterSlider";
    if (this.props.cutoffHighlight !== null) {
      let color = CLIENT_COLORS[this.props.cutoffHighlight % CLIENT_COLORS.length];
      sliderStyle = { backgroundColor: color };
    }

    let seqRowHeaders = [];
    for (let i = 0; i < this.props.sequencerMatrix.length; ++i) {
        seqRowHeaders.push(fromRowToNoteName(i, this.props.sequencerMatrix.length));
    }

    return (
      <div>
        <div className={sliderClass} style={sliderStyle}>
          <label>
            Cutoff
            <input ref={this.cutoffInput}
              type="range"
              value={this.props.cutoff}
              onInput={(e) => this.props.onCutoffLocalUpdate(e.target.value)}
              min="0" max="1" step="0.01"
            />
          </label>
        </div>        
        <SequencerTable
          setting={this.props.sequencerMatrix}
          beatIx={this.props.beatIx}
          onClick={this.props.onClick}
          userHighlights={this.props.seqHighlights}
          seqRowHeaders={seqRowHeaders}/> 
      </div>
    );
  }
}

function UserList(props) {
  let getItemStyle = (id) => {
    return {
      backgroundColor: CLIENT_COLORS[id % CLIENT_COLORS.length],
      color: CLIENT_COLORS_TEXT[id % CLIENT_COLORS_TEXT.length]
    };
  };
  let listItems = props.users.map((item) => <li key={item.id}><span style={getItemStyle(item.id)}>{item.name}</span></li>);
  return (
    <div>
      <p>Connected users:</p>
      <ul>{listItems}</ul>
    </div>
  );
}

function noteFrequency(note_ix) {
  const MAX_NOTE_INDEX = 70;
  if (note_ix > MAX_NOTE_INDEX || note_ix < 0) {
      throw "invalid note index (" + note_ix + ")";
  }
  const base_freq_ix = note_ix % sound.BASE_FREQS.length;
  const num_octaves_above = Math.floor(note_ix / sound.BASE_FREQS.length);
  return sound.BASE_FREQS[base_freq_ix] * (1 << num_octaves_above);
}

// 16 rows.
// row 0: noteIx 15 + 2*12
// ro 15: noteIx 0 + 2*12
function fromCellToFreq(row, numRows) {
  let noteIx = (numRows - 1) - row;
  return noteFrequency(noteIx + sound.NUM_CHROMATIC_NOTES*2);
}

function fromCellToSampleIx(row, numRows) {
  return (numRows - 1) - row;
}

const NOTE_NAMES = [
    'A',
    'Bb',
    'B',
    'C',
    'Db',
    'D',
    'Eb',
    'E',
    'F',
    'Gb',
    'G',
    'Ab'
]
function fromRowToNoteName(row, numRows) {
  let noteIx = (numRows - 1) - row;
  noteIx = noteIx % NOTE_NAMES.length; 
  return NOTE_NAMES[noteIx];
}

function openSocket() {
  return new Promise(function(resolve, reject) {
      let socket =
          new WebSocket('ws://' + window.location.hostname + ':2795',
                        'giogadi');
      socket.onopen = function(e) {
          resolve(socket);
      }
      socket.onerror = function(e) {
          reject(e);
      }
  });
}

function filterParamToValue(param) {
  return param * 10000;
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      synthSeqTables: [],
      synthCutoffs: [],
      samplerTable: [],
      users: [],
      beatIndex: -1
    };

    this.username = props.username;

    const DEFAULT_NUM_SYNTHS = 2;
    for (let synthIx = 0; synthIx < DEFAULT_NUM_SYNTHS; ++synthIx) {
      let seqTable = [];
      const DEFAULT_NUM_SYNTH_ROWS = 14;
      const DEFAULT_NUM_SYNTH_BEATS = 16;
      for (let i = 0; i < DEFAULT_NUM_SYNTH_ROWS; ++i) {
        let row = [];
        for (let j = 0; j < DEFAULT_NUM_SYNTH_BEATS; ++j) {
          row.push(0);
        }
        seqTable.push(row);
      }
      this.state.synthSeqTables.push(seqTable);

      this.state.synthCutoffs.push(0.5);
    }

    const DEFAULT_NUM_SAMPLER_ROWS = 2;
    const DEFAULT_NUM_SAMPLER_BEATS = 16;
    for (let i = 0; i < DEFAULT_NUM_SAMPLER_ROWS; ++i) {
      let row = [];
      for (let j = 0; j < DEFAULT_NUM_SAMPLER_BEATS; ++j) {
        row.push(0);
      }
      this.state.samplerTable.push(row);
    }

    this.numSamplerVoices = 2;

    this.getNumVoices = this.getNumVoices.bind(this);

    this.handleSynthSeqClick = this.handleSynthSeqClick.bind(this);
    this.handleSamplerClick = this.handleSamplerClick.bind(this);
    this.handlePlayButtonClick = this.handlePlayButtonClick.bind(this);
    this.perBeat = this.perBeat.bind(this);
    this.synthPerBeat = this.synthPerBeat.bind(this);
    this.samplerPerBeat = this.samplerPerBeat.bind(this);
    this.updateStateFromSocketEvent = this.updateStateFromSocketEvent.bind(this);
    this.handleCutoffLocalUpdate = this.handleCutoffLocalUpdate.bind(this);
    this.handleCutoffGlobalUpdate = this.handleCutoffGlobalUpdate.bind(this);

    this.setSynthCutoffFromParam = this.setSynthCutoffFromParam.bind(this);

    this.playIntervalId = null;
    
    this.clientId = null;

    this.unacknowledgedUpdates = [];
  }

  async componentDidMount() {
    // TODO: this is how other people do async functions. why?
    // const initSoundAsync = async () => {
    //   this.sound = await initSound();
    // };
    // initSoundAsync();
    this.sound = await sound.initSound();

    // Set init sound props to match the ones in App state
    for (let i = 0; i < this.state.synthCutoffs.length && i < this.sound.synths.length; ++i) {
      this.sound.synths[i].filterDefault = filterParamToValue(this.state.synthCutoffs[i]);
    }

    try {
      this.socket = await openSocket();
      // Send username over socket
      let msg = {
        Connect: {
          username: this.username
        }
      };
      const jsonStr = JSON.stringify(msg);
      this.socket.send(jsonStr);
      console.log("Sent " + jsonStr);
      
    } catch (e) {
      this.socket = null;
    }
    
    if (this.socket !== null) {
      this.socket.onmessage = this.updateStateFromSocketEvent;
    }
  }

  updateStateFromSocketEvent(event) {
    let incomingMsg = JSON.parse(event.data);
    console.log("Received message " + event.data);

    // STATE SYNC UPDATE
    // TODO: THIS SURE IS A HACKY WAY TO DETECT A STATE SYNC UPDATE LOL
    if (incomingMsg.hasOwnProperty("synth_sequences")) {  
      console.log("STATE SYNC UPDATE!");
      this.unacknowledgedUpdates = [];
      let newState = incomingMsg;
      let newSynthSeqs = [];
      let numSynths = newState.synth_sequences.length;
      
      for (let s = 0; s < numSynths; ++s) {
        let incomingStateSeq = newState.synth_sequences[s];
        let synthSeq = [];
        let numRows = newState.num_synth_note_rows;
        let numCols = incomingStateSeq.length;
        let numVoices = incomingStateSeq[0].length;
        for (let r = 0; r < numRows; ++r) {
          let row = [];
          for (let c = 0; c < numCols; ++c) {
            row.push(0);
          }
          synthSeq.push(row);
        }
        for (let c = 0; c < numCols; ++c) {
          for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
            let v = incomingStateSeq[c][voiceIx];
            if (v >= 0) {
              synthSeq[v][c] = 1;
            }            
          }
        }
        newSynthSeqs.push(synthSeq);
      }

      let newSamplerSeq = [];
      {
        let incomingStateSeq = newState.sampler_sequence;
        let numRows = newState.num_sampler_note_rows;
        let numCols = incomingStateSeq.length;
        let numVoices = incomingStateSeq[0].length;
        for (let r = 0; r < numRows; ++r) {
          let row = [];
          for (let c = 0; c < numCols; ++c) {
            row.push(0);
          }
          newSamplerSeq.push(row);
        }
        for (let c = 0; c < numCols; ++c) {
          for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
            let v = incomingStateSeq[c][voiceIx];
            if (v >= 0) {
              newSamplerSeq[v][c] = 1;
            }            
          }
        }
      }

      let newUsers = [];
      for (let i = 0; i < newState.connected_clients.length; ++i) {
        newUsers.push({
          id: newState.connected_clients[i][0],
          name: newState.connected_clients[i][1],
          lastTouched: null
        });
      }

      if (this.clientId === null) {
        // Assume last item in connected_clients is me. Get client ID from there.
        this.clientId = newState.connected_clients[newState.connected_clients.length - 1][0];
      }

      for (let i = 0; i < numSynths; ++i) {
        this.setSynthCutoffFromParam(i, newState.synth_cutoffs[i]);
      }

      this.setState({
        synthSeqTables: newSynthSeqs,
        synthCutoffs: newState.synth_cutoffs,
        samplerTable: newSamplerSeq,
        users: newUsers
      });

      return;
    }

    // OK NOT A STATE SYNC NOW
    console.log("NOT A STATE SYNC");

    let sourceClientId = incomingMsg.client_id;
    let generalUpdate = incomingMsg.update;

    console.log(generalUpdate);

    if (generalUpdate.hasOwnProperty("Connect")/* || generalUpdate === "Connect"*/) {
      if (this.clientId !== sourceClientId) {
        this.setState((oldState, props) => {
          let newUsers = oldState.users.slice();
          newUsers.push({
            id: sourceClientId,
            name: generalUpdate.Connect.username,
            lastTouched: null
          });
          return {
            users: newUsers
          };
        });
      }
    } else if (generalUpdate.hasOwnProperty("Disconnect") || generalUpdate === "Disconnect") {

      this.setState((oldState, props) => {
        let newUsers = [];

        for (let i = 0; i < oldState.users.length; ++i) {
          if (oldState.users[i].id !== sourceClientId) {
            newUsers.push(oldState.users[i]);
          }
        }

        return {
          users: newUsers
        };
      });
    }

    if (sourceClientId === this.clientId) {
      for (let unackIx = 0; unackIx < this.unacknowledgedUpdates.length; ++unackIx) {
        // TODO: can element ordering cause this to mess up since server
        // re-serializes client message?
        let unack = this.unacknowledgedUpdates[unackIx];
        let updateStr = JSON.stringify(incomingMsg.update);
        // console.log("HOWDY " + unackIx + ". I sent: " + unack.raw);
        // console.log("I received: " + updateStr);
        if (unack.raw === updateStr) {
          console.log("I see my unacknowledged message!");
          this.unacknowledgedUpdates.splice(unackIx, 1);
          break;
        }
      }
      return;
    }

    // If we find an unacknowledged update that is in conflict with the incoming
    // update, ignore the incoming one.
    for (let unackIx = 0; unackIx < this.unacknowledgedUpdates.length; ++unackIx) {
      let generalUnack = this.unacknowledgedUpdates[unackIx].parsed;
      if (generalUnack.hasOwnProperty("SynthSeq")) {
        if (generalUpdate.hasOwnProperty("SynthSeq")) {
          let unack = generalUnack.SynthSeq;
          let update = generalUpdate.SynthSeq;
          if (unack.synth_ix === update.synth_ix && unack.beat_ix === update.beat_ix) {
            console.log(`Ignoring update: ${update}`);
            return;
          }
        }
      } else if (generalUnack.hasOwnProperty("SamplerSeq")) {
        if (generalUpdate.hasOwnProperty("SamplerSeq")) {
          let unack = generalUnack.SamplerSeq;
          let update = generalUpdate.SamplerSeq;
          if (unack.beat_ix === update.beat_ix) {
            console.log(`Ignoring update: ${update}`);
            return;
          }
        }
      } else if (generalUnack.hasOwnProperty("SynthFilterCutoff")) {
        if (generalUpdate.hasOwnProperty("SynthFilterCutoff")) {
          let unack = generalUnack.SynthFilterCutoff;
          let update = generalUpdate.SynthFilterCutoff;
          if (unack.synth_ix === update.synth_ix) {
            console.log(`Ignoring update: ${update}`);
            return;
          }
        }
      }
    }

    if (generalUpdate.hasOwnProperty("SynthSeq")) {
      // TODO: do validation of voices
      let update = generalUpdate.SynthSeq;
      this.setState((oldState, props) => {
        let newSynthSeqs = oldState.synthSeqTables.slice();
        {
          newSynthSeqs[update.synth_ix] = oldState.synthSeqTables[update.synth_ix].slice();
          let newSynthSeqTable = newSynthSeqs[update.synth_ix];
          let numRows = newSynthSeqTable.length;
          for (let r = 0; r < numRows; ++r) {
            newSynthSeqTable[r][update.beat_ix] = 0;
          }
          let numVoices = update.active_cell_ixs.length;
          for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
            let v = update.active_cell_ixs[voiceIx];
            if (v >= 0) {
              newSynthSeqTable[v][update.beat_ix] = 1;
            }
          }
        }

        let newUsers = oldState.users.slice();
        for (let i = 0; i < newUsers.length; ++i) {
          if (newUsers[i].id === sourceClientId) {
            newUsers[i].lastTouched = {
              type: "synth_seq",
              synthIx: update.synth_ix,
              row: update.clicked_cell_ix,
              col: update.beat_ix
            };
          }
        }

        return {
          synthSeqTables: newSynthSeqs,
          users: newUsers
        };
      });
    } else if (generalUpdate.hasOwnProperty("SamplerSeq")) {
      let update = generalUpdate.SamplerSeq;
      this.setState((oldState, props) => {
        let newSeqTable = oldState.samplerTable.slice();

        let numRows = newSeqTable.length;
        for (let r = 0; r < numRows; ++r) {
          newSeqTable[r][update.beat_ix] = 0;
        }
        let numVoices = update.active_cell_ixs.length;
        for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
          let v = update.active_cell_ixs[voiceIx];
          if (v >= 0) {
            newSeqTable[v][update.beat_ix] = 1;
          }
        }

        let newUsers = oldState.users.slice();
        for (let i = 0; i < newUsers.length; ++i) {
          if (newUsers[i].id === sourceClientId) {
            newUsers[i].lastTouched = {
              type: "sampler_seq",
              row: update.clicked_cell_ix,
              col: update.beat_ix
            };
          }
        }

        return {
          samplerTable: newSeqTable,
          users: newUsers
        };
      });
    } else if (generalUpdate.hasOwnProperty("SynthFilterCutoff")) {
      let update = generalUpdate.SynthFilterCutoff;
      this.setState((oldState, props) => {
        let newCutoffs = oldState.synthCutoffs.slice();
        newCutoffs[update.synth_ix] = update.value;
        this.setSynthCutoffFromParam(update.synth_ix, update.value);

        let newUsers = oldState.users.slice();
        for (let i = 0; i < newUsers.length; ++i) {
          if (newUsers[i].id === sourceClientId) {
            newUsers[i].lastTouched = {
              type: "synth_cutoff",
              synthIx: update.synth_ix,
              value: update.value
            };
          }
        }

        return {
          synthCutoffs: newCutoffs,
          users: newUsers
        };
      });
    }
  }

  getNumVoices(synthIx) {
    return this.sound.synths[synthIx].voices.length;
  }

  synthPerBeat(beatIndex) {
    let numSynths = this.state.synthSeqTables.length;
    for (let synthIx = 0; synthIx < numSynths; ++synthIx) {
      let numRows = this.state.synthSeqTables[synthIx].length;
      let numBeats = this.state.synthSeqTables[synthIx][0].length;
      let voices = [];
      for (let row = 0; row < numRows; ++row) {
        if (this.state.synthSeqTables[synthIx][row][beatIndex]) {
          voices.push(fromCellToFreq(row, numRows));
        }
      }
      console.assert(voices.length <= this.getNumVoices(0));
      sound.synthPlayVoices(this.sound.synths[synthIx], voices, this.sound.audioCtx);
    }
  }

  samplerPerBeat(beatIndex) {
    let numRows = this.state.samplerTable.length;
    let numBeats = this.state.samplerTable[0].length;

    let cellIx;
    for (let row = 0; row < numRows; ++row) {
      if (this.state.samplerTable[row][beatIndex]) {
        cellIx = fromCellToSampleIx(row, numRows);
        console.assert(cellIx < this.sound.drumSounds.length);
        sound.playSoundFromBuffer(this.sound.audioCtx, this.sound.drumSounds[cellIx]);
      }
    }
  }

  perBeat() {
    // TODO!!!!!! We should make this allow for different beat lengths on different sequencers.
    let numBeats = this.state.synthSeqTables[0][0].length;

    // TODO: might be a problem to depend on current state here
    let newBeatIx = (this.state.beatIndex + 1) % numBeats;
    console.assert(newBeatIx >= 0);

    this.synthPerBeat(newBeatIx);
    this.samplerPerBeat(newBeatIx);

    // NOTE: THE PARENTHESIS RIGHT AFTER THE ARROW IS EXTREMELY IMPORTANT!!!!!
    this.setState((state, props) => ({
      beatIndex: newBeatIx
    }));
  }

  handlePlayButtonClick() {
    if (this.playIntervalId === null) {
      let bpm = 480;
      const ticksPerBeat = (1 / bpm) * 60 * 1000;
      this.playIntervalId = window.setInterval(this.perBeat, ticksPerBeat);
      this.setState({ beatIndex: -1 });
    } else {
      window.clearInterval(this.playIntervalId);
      this.playIntervalId = null;
      this.setState({ beatIndex: -1 });
    }
  }

  setSynthCutoffFromParam(synthIx, newCutoffParam) {
    this.sound.synths[synthIx].filterDefault = filterParamToValue(newCutoffParam);
  }

  handleCutoffLocalUpdate(synthIx, newCutoffParamStr) {
    const newCutoffParam = parseFloat(newCutoffParamStr);
    this.setSynthCutoffFromParam(synthIx, newCutoffParam);

    let newCutoffs = this.state.synthCutoffs.slice();
    newCutoffs[synthIx] = newCutoffParam;
    this.setState({
      synthCutoffs: newCutoffs
    });
  }

  handleCutoffGlobalUpdate(synthIx, newCutoffParamStr) {
    // TODO: do I need to do the local update stuff too or can I just assume
    // that the local update will have already run?
    if (this.socket !== null) {
      let msg = {
        SynthFilterCutoff: {
          synth_ix: synthIx,
          value: parseFloat(newCutoffParamStr)
        }
      };
      const jsonStr = JSON.stringify(msg);
      this.unacknowledgedUpdates.push({
        raw: jsonStr,
        parsed: msg
      });
      this.socket.send(jsonStr);
      console.log("Sent " + jsonStr);
    }
  }

  // If it returns null, then no change to seq
  newSeqFromClick(seq, row, col, numVoices) {
    const numRows = seq.length;

    let newTable = seq.slice();
    if (seq[row][col]) {
       newTable[row][col] = 0; 
    } else {
      // count number of active voices in this column
      let activeVoices = 0;
      let lastVoiceRow = 0;
      for (let r = 0; r < numRows; ++r) {
        if (seq[r][col]) {
          ++activeVoices;
          lastVoiceRow = r;
        }
      }
      if (activeVoices >= numVoices) {
        newTable[lastVoiceRow][col] = 0;
      }
      newTable[row][col] = 1;

    }
    return newTable;

  }

  // TODO: do they have to be TOTAL copies?
  newSeqsFromClick(seqs, clickedSynthIx, row, col, numVoices) {
    let newClickedSeq = this.newSeqFromClick(seqs[clickedSynthIx], row, col, numVoices);
    if (newClickedSeq === null) {
      // If no changes, return null to signify no changes.
      return null;
    }

    let newTables = seqs.slice();
    newTables[clickedSynthIx] = newClickedSeq;
    return newTables;
  }

  handleSynthSeqClick(synthIx, row, col) {
    let newTables = this.newSeqsFromClick(this.state.synthSeqTables, synthIx, row, col, this.getNumVoices(synthIx));
    if (newTables === null) {
      return;
    }

    this.setState({
        synthSeqTables: newTables
    });

    if (this.socket !== null) {  
      let activeCellIxs = [];
      let numVoices = this.getNumVoices(synthIx);
      for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
        activeCellIxs.push(-1);
      }
      let numRows = newTables[synthIx].length;
      let voiceIx = 0;
      for (let r = 0; r < numRows; ++r) {
        if (newTables[synthIx][r][col] === 1) {
          activeCellIxs[voiceIx] = r;
          ++voiceIx;
        }
      }

      const msg = {
        SynthSeq: {
          synth_ix: synthIx,
          beat_ix: col,
          active_cell_ixs: activeCellIxs,
          clicked_cell_ix: row
        }
      };
      const jsonMsg = JSON.stringify(msg);
      this.unacknowledgedUpdates.push({
        raw: jsonMsg,
        parsed: msg
      });
      this.socket.send(jsonMsg);
      console.log("Sent " + jsonMsg);
    }
  }

  handleSamplerClick(row, col) {
    let newTable = this.newSeqFromClick(this.state.samplerTable, row, col, 2);
    if (newTable === null) {
      return;
    }

    this.setState({
        samplerTable: newTable
    });

    if (this.socket !== null) {
      let activeCellIxs = [];
      let numVoices = this.numSamplerVoices;
      for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
        activeCellIxs.push(-1);
      }
      let numRows = newTable.length;
      let voiceIx = 0;
      for (let r = 0; r < numRows; ++r) {
        if (newTable[r][col] === 1) {
          activeCellIxs[voiceIx] = r;
          ++voiceIx;
        }
      }
      const msg = {
        SamplerSeq: {
          beat_ix: col,
          active_cell_ixs: activeCellIxs,
          clicked_cell_ix: row
        }
      };
      const jsonMsg = JSON.stringify(msg);
      this.unacknowledgedUpdates.push({
        raw: jsonMsg,
        parsed: msg
      });
      this.socket.send(jsonMsg);
      console.log("Sent " + jsonMsg);
    }
  }

  render() {
    let synthIxs = [];
    let synthSeqHighlights = [];
    let synthCutoffHighlights = [];
    for (let i = 0; i < this.state.synthSeqTables.length; ++i) {
      synthIxs.push(i);
      synthSeqHighlights.push([]);
      synthCutoffHighlights.push(null);
    }

    let samplerSeqHighlights = [];
    for (let i = 0; i < this.state.users.length; ++i) {
      let lastTouched = this.state.users[i].lastTouched;
      if (lastTouched !== null) {
        let touchType = lastTouched.type;
        if (touchType === "synth_seq") {
          synthSeqHighlights[lastTouched.synthIx].push({
            id: this.state.users[i].id,
            row: lastTouched.row,
            col: lastTouched.col
          });
        } else if (touchType === "sampler_seq") {
          samplerSeqHighlights.push({
            id: this.state.users[i].id,
            row: lastTouched.row,
            col: lastTouched.col
          });
        } else if (touchType === "synth_cutoff") {
          synthCutoffHighlights[lastTouched.synthIx] = this.state.users[i].id;
        }
      }
    }
    let drumSeqHeaders = ['Snare', 'Kick'];
    return (
      <div>
        <UserList users={this.state.users} />
        <button onClick={this.handlePlayButtonClick}>Play/Stop</button>
        { synthIxs.map((s) => 
            <div key={s.toString()}>
              <h2>Synth {s}</h2>
              <SynthComponent
                sequencerMatrix={this.state.synthSeqTables[s]}
                cutoff={this.state.synthCutoffs[s]}
                beatIx={this.state.beatIndex}
                onClick={(r,c) => this.handleSynthSeqClick(s,r,c)}
                onCutoffLocalUpdate={(cutoff) => this.handleCutoffLocalUpdate(s,cutoff)}
                onCutoffGlobalUpdate={(cutoff) => this.handleCutoffGlobalUpdate(s,cutoff)}  
                seqHighlights={synthSeqHighlights[s]}
                cutoffHighlight={synthCutoffHighlights[s]}
              /> 
              <br />
            </div>)}
        <h2>Drum machine</h2>
        <SequencerTable
          setting={this.state.samplerTable}
          beatIx={this.state.beatIndex}
          onClick={this.handleSamplerClick} 
          userHighlights={samplerSeqHighlights}
          seqRowHeaders={drumSeqHeaders}
        />
      </div>
    );
  }
}

async function main() {
  // Let's wait for a mouse click before doing anything
  // let msg = document.getElementById('message');
  // msg.innerHTML = 'Click to start';
  let submitButton = document.getElementById('submit_name');
  const waitForClick = () =>
      new Promise((resolve) => {
          submitButton.addEventListener('click', () => resolve(), {once: true});
      });
  await waitForClick();
  let usernameField = document.getElementById('name');
  let username = usernameField.value;

  document.getElementById('message').remove();
  usernameField.remove();
  submitButton.remove();

  const domContainer = document.querySelector('#root');
  const root = ReactDOM.createRoot(domContainer);
  root.render(<App username={username}/>);
}

main();
