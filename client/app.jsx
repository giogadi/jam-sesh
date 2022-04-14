'use strict';

const CLIENT_COLORS = ['cyan', 'magenta', 'orange', 'lightblue', 'navy', 'purple', 'aquamarine', 'darkgreen'];

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
      let highlights = this.props.userHighlights;
      for (let i = 0; i < highlights.length; ++i) {
        if (highlights[i].row === r && highlights[i].col === c) {
          className += " highlightCell";
          break;
        }
      }
      if (onBeat) {
        className += " OnBeat";
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

    return (
      <div>
        <span className={sliderClass} style={sliderStyle}>
          <input ref={this.cutoffInput}
            type="range"
            value={this.props.cutoff}
            onInput={(e) => this.props.onCutoffLocalUpdate(e.target.value)}
            min="0" max="1" step="0.01"
          />
        </span>        
        <SequencerTable
          setting={this.props.sequencerMatrix}
          beatIx={this.props.beatIx}
          onClick={this.props.onClick}
          userHighlights={this.props.seqHighlights} /> 
      </div>
    );
  }
}

function UserList(props) {
  let getItemStyle = (id) => {
    return { backgroundColor: CLIENT_COLORS[id % CLIENT_COLORS.length] };
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
      users: [],
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
      // Send username over socket
      let msg = {
        update_type: "new_client",
        username: this.username
      }
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
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    if (update.update_type == "new_client") {
      if (this.clientId !== update.client_id) {
        this.setState((oldState, props) => {
          let newUsers = oldState.users.slice();
          newUsers.push({
            id: update.client_id,
            name: update.username,
            lastTouched: null
          });
          return { users: newUsers };
        });
      }
    } else if (update.update_type == "disconnect") {
      this.setState((oldState, props) => {
        let newUsers = [];
        for (let i = 0; i < oldState.users.length; ++i) {
          if (oldState.users[i].id !== update.client_id) {
            newUsers.push(oldState.users[i]);
          }
        }
        return { users: newUsers };
      });
    } else if (update.update_type == "sync") {
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
        this.clientId = newState.connected_clients[newState.connected_clients.length-1][0];
      }

      this.setState({
        synthSeqTables: newSynthSeqs,
        synthCutoffs: newState.synth_cutoffs,
        samplerTable: newSamplerSeq,
        users: newUsers
      })
    }
    if (update.client_id !== this.client_id) {
      if (update.update_type == "synth_seq") {
        // TODO: do validation of voices
        this.setState((oldState,props) => {
          let newSynthSeqs = oldState.synthSeqTables.slice();
          newSynthSeqs[update.synth_ix][update.cell_ix][update.beat_ix] = update.on ? 1 : 0;
          let newUsers = oldState.users.slice();
          for (let i = 0; i < newUsers.length; ++i) {
            if (newUsers[i].id === update.client_id) {
              newUsers[i].lastTouched = {
                type: "synth_seq",
                synthIx: update.synth_ix,
                row: update.cell_ix,
                col: update.beat_ix
              };
            }
          }
          return {
            synthSeqTabls: newSynthSeqs,
            users: newUsers
          };
        });
      } else if (update.update_type == "sampler_seq") {
        this.setState((oldState,props) => {
          let newSeq = oldState.samplerTable.slice();
          newSeq[update.cell_ix][update.beat_ix] = update.on ? 1 : 0;
          let newUsers = oldState.users.slice();
          for (let i = 0; i < newUsers.length; ++i) {
            if (newUsers[i].id === update.client_id) {
              newUsers[i].lastTouched = {
                type: "sampler_seq",
                row: update.cell_ix,
                col: update.beat_ix
              };
            }
          }
          return {
            samplerTable: newSeq,
            users: newUsers
          };
        })
      } else if (update.update_type == "filter_cutoff") {
        this.setState((oldState,props) => {
          let newCutoffs = oldState.synthCutoffs.slice();
          newCutoffs[update.synth_ix] = update.value;
          let newUsers = oldState.users.slice();
          for (let i = 0; i < newUsers.length; ++i) {
            if (newUsers[i].id === update.client_id) {
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
        client_id: this.clientId,
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
        client_id: this.clientId,
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
        client_id: this.clientId,
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
    return (
      <div>
        <UserList users={this.state.users} />
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
                seqHighlights={synthSeqHighlights[s]}
                cutoffHighlight={synthCutoffHighlights[s]}
              /> 
              <br />
            </div>)}
        <SequencerTable
          setting={this.state.samplerTable}
          beatIx={this.state.beatIndex}
          onClick={this.handleSamplerClick} 
          userHighlights={samplerSeqHighlights}
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