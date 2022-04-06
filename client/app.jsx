'use strict';

class SequencerTable extends React.Component {
  constructor(props) {
    super(props); 
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
      <table className="sequencerTable">
        <tbody>
          { rows.map((r) =>
              <tr key={r.toString()}>
                { columns.map((c) =>
                  <td className="sequencerTd" key={c.toString()}>
                    {
                      <button className={getButtonClass(r,c,this.props.beatIx-1)} 
                        onClick={() => this.props.onClick(r,c)}
                      />
                    }
                  </td>)}
              </tr>)}
        </tbody>
      </table>
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
      synthSeqTable: [],
      samplerTable: [],
      beatIndex: -1
    };
    const DEFAULT_NUM_SYNTH_ROWS = 12;
    const DEFAULT_NUM_SYNTH_BEATS = 16;
    for (let i = 0; i < DEFAULT_NUM_SYNTH_ROWS; ++i) {
      let row = [];
      for (let j = 0; j < DEFAULT_NUM_SYNTH_BEATS; ++j) {
        row.push(0);
      }
      this.state.synthSeqTable.push(row);
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
    let newSynthSeq = [];
    {
      let numRows = update.synth_sequence.length;
      let numCols = update.synth_sequence[0].length;
      for (let r = 0; r < numRows; ++r) {
        let row = [];
        for (let c = 0; c < numCols; ++c) {
          row.push(update.synth_sequence[r][c]);
        }
        newSynthSeq.push(row);
      }
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
      synthSeqTable: newSynthSeq,
      samplerTable: newSamplerSeq
    })
  }

  getNumVoices(synthIx) {
    return this.sound.synths[synthIx].voices.length;
  }

  synthPerBeat() {
    let numRows = this.state.synthSeqTable.length;
    let numBeats = this.state.synthSeqTable[0].length;

    let voices = [];
    for (let row = 0; row < numRows; ++row) {
      if (this.state.synthSeqTable[row][this.state.beatIndex]) {
        voices.push(fromCellToFreq(row, numRows));
      }
    }

    console.assert(voices.length <= this.getNumVoices(0));

    synthPlayVoices(this.sound.synths[0], voices, this.sound.audioCtx);
  }

  samplerPerBeat() {
    let numRows = this.state.samplerTable.length;
    let numBeats = this.state.samplerTable[0].length;

    let cellIx;
    for (let row = 0; row < numRows; ++row) {
      if (this.state.samplerTable[row][this.state.beatIndex]) {
        cellIx = fromCellToSampleIx(row, numRows);
        console.assert(cellIx < this.sound.drumSounds.length);
        playSoundFromBuffer(this.sound.audioCtx, this.sound.drumSounds[cellIx]);
      }
    }
  }

  perBeat() {
    console.assert(this.state.beatIndex >= 0);

    this.synthPerBeat();
    this.samplerPerBeat();

    let numBeats = this.state.synthSeqTable[0].length;

    // NOTE: THE PARENTHESIS RIGHT AFTER THE ARROW IS EXTREMELY IMPORTANT!!!!!
    this.setState((state, props) => ({
      beatIndex: (state.beatIndex + 1) % numBeats
    }));
  }

  handlePlayButtonClick() {
    if (this.playIntervalId === null) {
      let bpm = 200;
      const ticksPerBeat = (1 / bpm) * 60 * 1000;
      this.playIntervalId = window.setInterval(this.perBeat, ticksPerBeat);
      this.setState({ beatIndex: 0 });
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

    let newTable = [];
    for (let r = 0; r < numRows; ++r) {
      newTable.push(seq[r].slice());
    }
    newTable[row][col] = newTable[row][col] ? 0 : 1;
    return newTable;
  }

  handleSynthSeqClick(row, col) {
    let newTable = this.newSeqFromClick(this.state.synthSeqTable, row, col, this.getNumVoices(0));
    if (newTable === null) {
      return;
    }

    this.setState({
        synthSeqTable: newTable
    });

    if (this.socket !== null) {
      let stateMsg = {
        synth_sequence: newTable,
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
        synth_sequence: this.state.synthSeqTable,
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
        <SequencerTable
          setting={this.state.synthSeqTable}
          beatIx={this.state.beatIndex}
          onClick={this.handleSynthSeqClick} />
        <br />
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