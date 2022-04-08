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

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      synthSeqTables: [],
      samplerTable: [],
      beatIndex: -1
    };
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

    this.playIntervalId = null;
  }

  async componentDidMount() {
    // TODO: this is how other people do async functions. why?
    // const initSoundAsync = async () => {
    //   this.sound = await initSound();
    // };
    // initSoundAsync();
    this.sound = await initSound();

    try {
      this.socket = await openSocket();
    } catch (e) {
      this.socket = null;
    }
    
    if (this.socket !== null) {
      this.socket.onmessage = this.updateStateFromSocketEvent;
    }
  }

  updateStateFromSocketEvent(event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    let newSynthSeqs = [];
    let numSynths = update.synth_sequences.length;
    for (let s = 0; s < numSynths; ++s) {
      let synthSeq = [];
      let numRows = update.synth_sequences[s].length;
      let numCols = update.synth_sequences[s][0].length;
      for (let r = 0; r < numRows; ++r) {
        let row = [];
        for (let c = 0; c < numCols; ++c) {
          row.push(update.synth_sequences[s][r][c]);
        }
        synthSeq.push(row);
      }
      newSynthSeqs.push(synthSeq);
    }

    let newSamplerSeq = [];
    {
      let numRows = update.sampler_sequence.length;
      let numCols = update.sampler_sequence[0].length;
      for (let r = 0; r < numRows; ++r) {
        let row = [];
        for (let c = 0; c < numCols; ++c) {
          row.push(update.sampler_sequence[r][c]);
        }
        newSamplerSeq.push(row);
      }
    }
    this.setState({
      synthSeqTables: newSynthSeqs,
      samplerTable: newSamplerSeq
    })
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
      let stateMsg = {
        synth_sequences: newTables,
        sampler_sequence: this.state.samplerTable
      };
      const stateMsgStr = JSON.stringify(stateMsg);
      this.socket.send(stateMsgStr);
      console.log("Sent " + stateMsgStr);
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
      let stateMsg = {
        synth_sequences: this.state.synthSeqTables,
        sampler_sequence: newTable
      };
      const stateMsgStr = JSON.stringify(stateMsg);
      this.socket.send(stateMsgStr);
      console.log("Sent " + stateMsgStr);
    }
  }

  render() {
    return (
      <div>
        <button onClick={this.handlePlayButtonClick}>Play/Stop</button>
        { [0,1].map((s) =>
            <div key={s.toString()}>
              <SequencerTable
                setting={this.state.synthSeqTables[s]}
                beatIx={this.state.beatIndex}
                onClick={(r,c) => this.handleSynthSeqClick(s,r,c)} /> 
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
  let msg = document.getElementById('message');
  msg.innerHTML = 'Click to start';
  const waitForClick = () =>
      new Promise((resolve) => {
          window.addEventListener('click', () => resolve(), {once: true});
      });
  await waitForClick();
  msg.innerHTML = '';

  const domContainer = document.querySelector('#root');
  const root = ReactDOM.createRoot(domContainer);
  root.render(<App />);
}

main();