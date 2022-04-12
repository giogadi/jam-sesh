'use strict';

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
      return className;
    };
    return (
      <div className="tableContainer" ref={this.tableContainer}>
        <table className="sequencerTable">
          <tbody>
            { rows.map((r) =>
                <tr key={r.toString()}>
                  { columns.map((c) =>
                    <td className="sequencerTd" key={c.toString()}>
                      {
                        <button className={getButtonClass(r,c,this.props.beatIx)} 
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
    return (
      <div>
        <input ref={this.cutoffInput}
          type="range"
          value={this.props.cutoff}
          onInput={(e) => this.props.onCutoffLocalUpdate(e.target.value)}
          min="0" max="1" step="0.01"/>
        <SequencerTable
          setting={this.props.sequencerMatrix}
          beatIx={this.props.beatIx}
          onClick={this.props.onClick} /> 
      </div>
    );
  }
}

function noteFrequency(note_ix) {
  const MAX_NOTE_INDEX = 70;
  if (note_ix > MAX_NOTE_INDEX || note_ix < 0) {
      throw "invalid note index (" + note_ix + ")";
  }
  const base_freq_ix = note_ix % BASE_FREQS.length;
  const num_octaves_above = Math.floor(note_ix / BASE_FREQS.length);
  return BASE_FREQS[base_freq_ix] * (1 << num_octaves_above);
}

// 16 rows.
// row 0: noteIx 15 + 2*12
// ro 15: noteIx 0 + 2*12
function fromCellToFreq(row, numRows) {
  let noteIx = (numRows - 1) - row;
  return noteFrequency(noteIx + NUM_CHROMATIC_NOTES*2);
}

function fromCellToSampleIx(row, numRows) {
  return (numRows - 1) - row;
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
      beatIndex: -1
    };

    this.username = props.username;

    const DEFAULT_NUM_SYNTHS = 2;
    for (let synthIx = 0; synthIx < DEFAULT_NUM_SYNTHS; ++synthIx) {
      let seqTable = [];
      const DEFAULT_NUM_SYNTH_ROWS = 12;
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

    this.playIntervalId = null;

    this.clientId = null;
  }

  async componentDidMount() {
    // TODO: this is how other people do async functions. why?
    // const initSoundAsync = async () => {
    //   this.sound = await initSound();
    // };
    // initSoundAsync();
    this.sound = await initSound();

    // Set init sound props to match the ones in App state
    for (let i = 0; i < this.state.synthCutoffs.length && i < this.sound.synths.length; ++i) {
      this.sound.synths[i].filterDefault = filterParamToValue(this.state.synthCutoffs[i]);
    }

    try {
      this.socket = await openSocket();
    } catch (e) {
      this.socket = null;
    }

    // Send username over socket
    let msg = {
      update_type: "new_client",
      username: this.username
    }
    const jsonStr = JSON.stringify(msg);
    this.socket.send(jsonStr);
    console.log("Sent " + jsonStr);
    
    if (this.socket !== null) {
      this.socket.onmessage = this.updateStateFromSocketEvent;
    }
  }

  updateStateFromSocketEvent(event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    if (update.update_type == "sync") {
      let newState = update.state;
      let newSynthSeqs = [];
      let numSynths = newState.synth_sequences.length;
      for (let s = 0; s < numSynths; ++s) {
        let synthSeq = [];
        let numRows = newState.synth_sequences[s].length;
        let numCols = newState.synth_sequences[s][0].length;
        for (let r = 0; r < numRows; ++r) {
          let row = [];
          for (let c = 0; c < numCols; ++c) {
            row.push(newState.synth_sequences[s][r][c]);
          }
          synthSeq.push(row);
        }
        newSynthSeqs.push(synthSeq);
      }

      let newSamplerSeq = [];
      {
        let numRows = newState.sampler_sequence.length;
        let numCols = newState.sampler_sequence[0].length;
        for (let r = 0; r < numRows; ++r) {
          let row = [];
          for (let c = 0; c < numCols; ++c) {
            row.push(newState.sampler_sequence[r][c]);
          }
          newSamplerSeq.push(row);
        }
      }
      this.setState({
        synthSeqTables: newSynthSeqs,
        synthCutoffs: newState.synth_cutoffs,
        samplerTable: newSamplerSeq
      })
    } else if (update.update_type == "synth_seq") {
      // TODO: do validation of voices
      this.setState((oldState,props) => {
        let newSynthSeqs = oldState.synthSeqTables.slice();
        newSynthSeqs[update.synth_ix][update.cell_ix][update.beat_ix] = update.on ? 1 : 0;
        return {
          synthSeqTabls: newSynthSeqs
        };
      });
    } else if (update.update_type == "sampler_seq") {
      this.setState((oldState,props) => {
        let newSeq = oldState.samplerTable.slice();
        newSeq[update.cell_ix][update.beat_ix] = update.on ? 1 : 0;
        return {
          samplerTable: newSeq
        };
      })
    } else if (update.update_type == "filter_cutoff") {
      this.setState((oldState,props) => {
        let newCutoffs = oldState.synthCutoffs.slice();
        newCutoffs[update.synth_ix] = update.value;
        return {
          synthCutoffs: newCutoffs
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
      synthPlayVoices(this.sound.synths[synthIx], voices, this.sound.audioCtx);
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
        playSoundFromBuffer(this.sound.audioCtx, this.sound.drumSounds[cellIx]);
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
      let bpm = 200;
      const ticksPerBeat = (1 / bpm) * 60 * 1000;
      this.playIntervalId = window.setInterval(this.perBeat, ticksPerBeat);
      this.setState({ beatIndex: -1 });
    } else {
      window.clearInterval(this.playIntervalId);
      this.playIntervalId = null;
      this.setState({ beatIndex: -1 });
    }
  }

  handleCutoffLocalUpdate(synthIx, newCutoffParamStr) {
    const newCutoffParam = parseFloat(newCutoffParamStr);
    const newCutoffValue = filterParamToValue(newCutoffParam);
    this.sound.synths[synthIx].filterDefault = newCutoffValue;

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
        update_type: "filter_cutoff",
        synth_ix: synthIx,
        value: parseFloat(newCutoffParamStr)
      }
      const jsonStr = JSON.stringify(msg);
      this.socket.send(jsonStr);
      console.log("Sent " + jsonStr);
    }
  }

  // If it returns null, then no change to seq
  newSeqFromClick(seq, row, col, numVoices) {
    const numRows = seq.length;

    // QUESTION: is it safe to define newTable in terms of state *outside of this.setState* 
    // and then set new state w.r.t. newTable (and therefore in terms of old state)??
    if (!seq[row][col]) {
      // count number of active voices in this column
      let activeVoices = 0;
      for (let r = 0; r < numRows; ++r) {
        if (seq[r][col]) {
          ++activeVoices;
        }
      }
      if (activeVoices >= numVoices) {
        return null;
      }
    }

    let newTable = seq.slice();
    newTable[row][col] = newTable[row][col] ? 0 : 1;
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
    let newTables = this.newSeqsFromClick(this.state.synthSeqTables, synthIx, row, col, this.getNumVoices(0));
    if (newTables === null) {
      return;
    }

    this.setState({
        synthSeqTables: newTables
    });

    if (this.socket !== null) {
      const msg = {
        update_type: "synth_seq",
        synth_ix: synthIx,
        beat_ix: col,
        cell_ix: row,
        on: (newTables[synthIx][row][col] === 1)
      }
      const jsonMsg = JSON.stringify(msg);
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
      const msg = {
        update_type: "sampler_seq",
        beat_ix: col,
        cell_ix: row,
        on: (newTable[row][col] === 1)
      }
      const jsonMsg = JSON.stringify(msg);
      this.socket.send(jsonMsg);
      console.log("Sent " + jsonMsg);
    }
  }

  render() {
    let synthIxs = [];
    for (let i = 0; i < this.state.synthSeqTables.length; ++i) {
      synthIxs.push(i);
    }
    return (
      <div>
        <button onClick={this.handlePlayButtonClick}>Play/Stop</button>
        { synthIxs.map((s) =>
            <div key={s.toString()}>
              <SynthComponent
                sequencerMatrix={this.state.synthSeqTables[s]}
                cutoff={this.state.synthCutoffs[s]}
                beatIx={this.state.beatIndex}
                onClick={(r,c) => this.handleSynthSeqClick(s,r,c)}
                onCutoffLocalUpdate={(cutoff) => this.handleCutoffLocalUpdate(s,cutoff)}
                onCutoffGlobalUpdate={(cutoff) => this.handleCutoffGlobalUpdate(s,cutoff)}  
              /> 
              <br />
            </div>)}
        <SequencerTable
          setting={this.state.samplerTable}
          beatIx={this.state.beatIndex}
          onClick={this.handleSamplerClick} />
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