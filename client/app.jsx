'use strict';

const NUM_BEATS = 16;
const NUM_VOICES = 2;
const NUM_ROWS = 16;

class SequencerTable extends React.Component {
  constructor(props) {
    super(props);
    let numColumns = NUM_BEATS;
    this.columns = [];
    for (let i = 0; i < numColumns; ++i) {
      this.columns.push(i);
    }

    this.rows = [];
    for (let i = 0; i < NUM_ROWS; ++i) {
      this.rows.push(i);
    }
  }

  render() {
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
          { this.rows.map((r) =>
              <tr key={r.toString()}>
                { this.columns.map((c) =>
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
function fromCellToFreq(row) {
  let noteIx = (NUM_ROWS - 1) - row;
  return noteFrequency(noteIx + NUM_CHROMATIC_NOTES*2);
}

// function convertNoteIxToTableRow(noteIx) {
//   let noteIxNoOctave = noteIx - NUM_CHROMATIC_NOTES*2;
//   if (noteIxNoOctave < 0) {
//     return -1;
//   }
//   if (noteIxNoOctave < 0 || noteIxNoOctave >= NUM_ROWS) {
//     console.assert("bad note ix " + noteIx);
//   }
//   return (NUM_ROWS - 1) - noteIxNoOctave;
// }

// function convertNoteSeqToTable(noteSeq) {
//   let seqTable = [];
//   for (let i = 0; i < NUM_ROWS; ++i) {
//     let row = [];
//     for (let j = 0; j < NUM_BEATS; ++j) {
//       row.push(false);
//     }
//     seqTable.push(row);
//   }

//   let numVoices = noteSeq[0].length;
//   console.assert(numVoices == NUM_VOICES);
//   console.assert(noteSeq.length === NUM_BEATS);
//   for (let beatIx = 0; beatIx < noteSeq.length; ++beatIx) {
//     for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
//       let noteIx = noteSeq[beatIx][voiceIx];
//       if (noteIx < 0) {
//         continue;
//       }
//       let tableRow = convertNoteIxToTableRow(noteIx);
//       if (tableRow >= 0) {
//         seqTable[tableRow][beatIx] = true;
//       }
//     }
//   }

//   return seqTable;
// }

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
      sequencerTable: [],
      beatIndex: -1
    };
    for (let i = 0; i < NUM_ROWS; ++i) {
      let row = [];
      for (let j = 0; j < NUM_BEATS; ++j) {
        row.push(false);
      }
      this.state.sequencerTable.push(row);
    }
    this.state.sequencerTable[0][0] = true;

    this.handleSequencerClick = this.handleSequencerClick.bind(this);
    this.handlePlayButtonClick = this.handlePlayButtonClick.bind(this);
    this.perBeat = this.perBeat.bind(this);
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

    this.socket = await openSocket();
    this.socket.onmessage = this.updateStateFromSocketEvent;
  }

  updateStateFromSocketEvent(event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    // this.synthSequence = update.synth_sequence.slice();
    // this.drumSequence = update.drum_sequence.slice();
    // this.currentScale = update.scale;
    // setFilterCutoff(this, update.filter_cutoff);
    this.setState({
      sequencerTable: update.synth_sequence.slice()
    })
  }

  perBeat() {
    console.assert(this.state.beatIndex >= 0);

    let voices = [];
    for (let row = 0; row < NUM_ROWS; ++row) {
      if (this.state.sequencerTable[row][this.state.beatIndex]) {
        voices.push(fromCellToFreq(row));
      }
    }

    console.assert(voices.length <= NUM_VOICES);

    synthPlayVoices(this.sound.synths[0], voices, this.sound.audioCtx);

    // NOTE: THE PARENTHESIS RIGHT AFTER THE ARROW IS EXTREMELY IMPORTANT!!!!!
    this.setState((state, props) => ({
      beatIndex: (state.beatIndex + 1) % NUM_BEATS
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

  handleSequencerClick(row, col) {
    // QUESTION: is it safe to define newTable in terms of state *outside of this.setState* 
    // and then set new state w.r.t. newTable (and therefore in terms of old state)??
    if (!this.state.sequencerTable[row][col]) {
      // count number of active voices in this column
      let numVoices = 0;
      for (let r = 0; r < NUM_ROWS; ++r) {
        if (this.state.sequencerTable[r][col]) {
          ++numVoices;
        }
      }
      if (numVoices >= NUM_VOICES) {
        return;
      }
    }

    let newTable = [];
    for (let r = 0; r < NUM_ROWS; ++r) {
      newTable.push(this.state.sequencerTable[r].slice());
    }
    newTable[row][col] = !newTable[row][col];

    this.setState((state, props) => {
      return {
        sequencerTable: newTable
      };
    });

    let stateMsg = {
      synth_sequence: newTable
      // drum_sequence: jamModel.drumSequence,
      // scale: jamModel.currentScale,
      // filter_cutoff: getFilterCutoff(jamModel)
    };
    const stateMsgStr = JSON.stringify(stateMsg);
    this.socket.send(stateMsgStr);
    console.log("Sent " + stateMsgStr);
  }

  render() {
    return (
      <div>
        <button onClick={this.handlePlayButtonClick}>Play/Stop</button>
        <SequencerTable
          setting={this.state.sequencerTable}
          beatIx={this.state.beatIndex}
          onClick={this.handleSequencerClick} />
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