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

function fromCellToFreq(row) {
  let noteIx = (NUM_ROWS - 1) - row;
  return noteFrequency(noteIx + NUM_CHROMATIC_NOTES*2);
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

    this.playIntervalId = null;
  }

  componentDidMount() {
    const initSoundAsync = async () => {
      this.sound = await initSound();
    };
    initSoundAsync();
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
    this.setState((state, props) => {
      if (!state.sequencerTable[row][col]) {
        // count number of active voices in this column
        let numVoices = 0;
        for (let r = 0; r < NUM_ROWS; ++r) {
          if (state.sequencerTable[r][col]) {
            ++numVoices;
          }
        }
        if (numVoices >= NUM_VOICES) {
          return state;
        }
      }

      let newTable = [];
      for (let r = 0; r < NUM_ROWS; ++r) {
        newTable.push(state.sequencerTable[r].slice());
      }
      newTable[row][col] = !newTable[row][col];

      return {
        sequencerTable: newTable
      };
    });
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