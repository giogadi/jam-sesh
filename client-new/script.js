"use strict";

import {initSound, initSynth, disconnectSynth} from './sound.js'

const SYNTH_PARAMS = [
    {
        name: "Cutoff",
        defaultValue: 6000,
        minValue: 0,
        maxValue: 22000,
        step: 1
    },
    {
        name: "Attack",
        defaultValue: 0.005,
        minValue: 0.001,
        maxValue: 1,
        step: 0.001
    }
];

function createElementAsChild(parentElement, tagName) {
    let child = document.createElement(tagName);
    return parentElement.appendChild(child);
}

let gSound = null;
let gSocket = null;
let gClientId = null;
let gHasReceivedState = false; 
let gMySound = null;
let gJamUI = null;
let gJamState = null;

function createEmptySeq(numSteps, numVoices) {
    let seq = [];
    for (let i = 0; i < 16; ++i) {
        let step = [];
        for (let v = 0; v < numVoices; ++v) {
            step.push(-1);
        }
        seq.push(step);
    }
    return seq;
}

// Maintains invariant that first active cell is the most recently activated one.
function seqStepToggleVoiceLifo(seqStep, midiNote) {
    // Check if this note is already active.
    for (let ii = 0; ii < seqStep.length; ++ii) {
        if (seqStep[ii] === midiNote) {
            seqStep[ii] = -1;
            return;
        }
    } 
    // Check if there are unused voices.
    for (let ii = 0; ii < seqStep.length; ++ii) {
        if (seqStep[ii] < 0) {
            seqStep[ii] = seqStep[0];
            seqStep[0] = midiNote;
            return;
        }
    }
    // If all voices are used, replace first active one (it'll be most recent).
    for (let ii = 0; ii < seqStep.length; ++ii) {
        if (seqStep[ii] >= 0) {
            seqStep[ii] = midiNote;
            return;
        }
    }
}

function defaultSynthParams() {
    let synthParams = [];
    for (let ii = 0; ii < SYNTH_PARAMS.length; ++ii) {
        synthParams.push(SYNTH_PARAMS[ii].defaultValue);
    }
    return synthParams;
}

// init gJamState
{
    gJamState = {
        synthSeqs: [
            createEmptySeq(16, 1),
            createEmptySeq(16, 1)
        ],
        synthParams: [
            defaultSynthParams(),
            defaultSynthParams()
        ]
    }
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

function disconnectMySound() {
    if (gMySound !== null) {
        gMySound.masterGain.disconnect();
        for (let i = 0; i < gMySound.synths.length; ++i) {
            disconnectSynth(gMySound.audioCtx, gMySound.synths[i]);
        }
        for (let i = 0; i < gMySound.drumSounds.length; ++i) {
            gMySound.drumSounds[i].gainNode.disconnect();
        }

        gMySound = null;
    }
}

function initMySound() {
    disconnectMySound();

    let masterGain = gSound.audioCtx.createGain();
    masterGain.connect(gSound.audioCtx.destination);

    let numSynths = gJamState.synthSeqs.length;
 
    let synths = [];
    for (let synthIx = 0; synthIx < numSynths; ++synthIx) {
        let synthSeq = gJamState.synthSeqs[synthIx];
        let numVoices = synthSeq[0].length; 

        let synthSpec = {
            gain: 0.25,
            filterCutoff: 1100,
            filterQ: 0.0,
            filterModFreq: 0,
            filterModGain: 0,
            attackTime: 0.0,
            releaseTime: 0.07,
            filterEnvAttack: 0.0,
            filterEnvRelease: 0.0,
            filterEnvIntensity: 0.0,
            osc1Type: 'square',
            osc2Type: 'sawtooth',
            osc2Gain: 0.5,
            osc2Detune: 50,
            numVoices: numVoices
        }
        synths.push(initSynth(gSound.audioCtx, synthSpec, masterGain));  
    }

    let sampleSounds = [];
    for (let i = 0; i < gSound.soundBuffers.length; ++i) {
        let sampleGainNode = gSound.audioCtx.createGain();
        sampleGainNode.gain.value = 0.5;
        sampleGainNode.connect(masterGain);
        sampleSounds.push({ buffer: gSound.soundBuffers[i], gainNode: sampleGainNode });
    }

    return {
        audioCtx: gSound.audioCtx,
        synths: synths,
        drumSounds: sampleSounds,
        masterGain: masterGain
    }
}

function onSocketMessage(e) {
    let incomingMsg = JSON.parse(e.data);
    console.log("Received message " + e.data);

    const isStateSyncUpdate = incomingMsg.hasOwnProperty("synth_sequences");
    if (isStateSyncUpdate) {
        if (!gHasReceivedState) {
            gJamState = null;
            {
                // TODO Is this bad?
                gJamState = { 
                    synthSeqs: incomingMsg.synth_sequences,
                    synthParams: incomingMsg.synth_params 
                };
            }

            gMySound = initMySound(); 
            buildJamUI(); 

            // Assume last item in connected_clients is me. Get client ID from there.
            gClientId = incomingMsg.connected_clients[incomingMsg.connected_clients.length - 1][0];

            gHasReceivedState = true;
        } 

        return;
    }

    // NOT A SYNC MESSAGE
    let sourceClientId = incomingMsg.client_id;
    let generalUpdate = incomingMsg.update;

    console.log(generalUpdate);
    if (sourceClientId === gClientId) {
        return;
    }

    if (generalUpdate.hasOwnProperty("SynthSeq")) {
        // Update state from message
        let update = generalUpdate.SynthSeq;
        let synthSeq = gJamState.synthSeqs[update.synth_ix];
        let seqStep = synthSeq[update.beat_ix];
        for (let i = 0; i < seqStep.length; ++i) {
            seqStep[i] = update.active_cell_ixs[i];
        }

        // Update UI
        setSeqStepFromState(update.synth_ix, update.beat_ix);
    } else if (generalUpdate.hasOwnProperty("SynthParam")) {
        let update = generalUpdate.SynthParam;
        let params = gJamState.synthParams[update.synth_ix];
        params[update.param_ix] = update.value;
        
        // Update UI
        let synthUI = gJamUI.synthUIs[update.synth_ix];
        let slider = synthUI.paramSliders[update.param_ix];
        slider.value = update.value;
    }
}

function buildJamUI() {
    if (gJamUI !== null) {
        gJamUI.jamDiv.remove();
        gJamUI = null;
    }
    let rootDiv = document.getElementById("root");
    let jamDiv = createElementAsChild(rootDiv, "div");
    const numSynths = gJamState.synthSeqs.length;
    let synthUIs = [];
    for (let i = 0; i < numSynths; ++i) {
        synthUIs.push(buildSynthUI(jamDiv, i)); 
    }

    gJamUI = {
        jamDiv: jamDiv,
        synthUIs: synthUIs
    };

    setUIFromState();
}

function setSeqStepFromState(synthIx, stepIx) {
    let synthUI = gJamUI.synthUIs[synthIx];
    let seq = gJamState.synthSeqs[synthIx];
    // clear out the sequence step first
    for (let r = 0; r < synthUI.numRows; ++r) {
        let btn = synthUI.seqButtons[r*synthUI.numCols + stepIx];
        btn.className = "sequencerCell sequencerCellInactive";
    }

    let seqStep = seq[stepIx];
    for (let voiceIx = 0; voiceIx < seqStep.length; ++voiceIx) {
        let note = seqStep[voiceIx];
        if (note < 0) {
            continue;
        }
        let btn = midiStepToSynthUIBtn(synthIx, stepIx, note);
        if (btn === null) {
            continue;
        }
        btn.className = "sequencerCell sequencerCellActive";
    }
}

function setUIFromState() {
    const numSynths = gJamState.synthSeqs.length;
    for (let synthIx = 0; synthIx < numSynths; ++synthIx) {
        let seq = gJamState.synthSeqs[synthIx];
        let synthUI = gJamUI.synthUIs[synthIx]   
        for (let stepIx = 0; stepIx < seq.length; ++stepIx) {
            setSeqStepFromState(synthIx, stepIx); 
        }
        let params = gJamState.synthParams[synthIx];
        for (let paramIx = 0; paramIx < params.length; ++paramIx) {
            let slider = synthUI.paramSliders[paramIx];
            slider.value = params[paramIx];
        }
    }
}

function buildSynthUI(rootNode, synthIx) {
    let synthSeq = gJamState.synthSeqs[synthIx];
    let numRows = 14;
    let numCols = synthSeq.length;
    let numVoices = synthSeq[0].length; 

    let synthHeader = createElementAsChild(rootNode, "h2");
    synthHeader.textContent = "Synth " + synthIx;

    let params = gJamState.synthParams[synthIx];
    let paramSliders = [];
    for (let paramIx = 0; paramIx < params.length; ++paramIx) {
        let spec = SYNTH_PARAMS[paramIx];
        let sliderDiv = createElementAsChild(rootNode, "div");
        let labelNode = createElementAsChild(sliderDiv, "label");
        labelNode.textContent = spec.name;
        let slider = createElementAsChild(labelNode, "input");
        slider.value = params[paramIx].value;
        slider.type = "range";
        slider.min = spec.minValue;
        slider.max = spec.maxValue;
        slider.step = spec.step;
        slider.className = "filterSlider";
        slider.addEventListener("change", (event) => onSliderChange(synthIx, paramIx, event));
        paramSliders.push(slider);
    }

    let tableDiv = createElementAsChild(rootNode, "div");
    tableDiv.className = "tableContainer";
    let tableElement = createElementAsChild(tableDiv, "table");
    tableElement.className = "sequencerTable";
    let tableBody = createElementAsChild(tableElement, "tbody");
   
    let seqButtons = [];
    for (let r = 0; r < numRows; ++r) {
        let tableRow = createElementAsChild(tableBody, "tr");
        for (let c = 0; c < numCols; ++c) {
            let col = createElementAsChild(tableRow, "td");
            col.className = "sequencerTd";
            let btn = createElementAsChild(col, "button");
            btn.className = "sequencerCell sequencerCellInactive";
            btn.addEventListener("click", () => onSeqClick(synthIx, r, c));  
            seqButtons.push(btn);
        }
    }

    return {
        numRows: numRows,
        numCols: numCols,
        startNote: 60, // C4
        paramSliders: paramSliders,
        seqButtons: seqButtons
    };
}

function onSeqClick(synthIx, clickR, clickC) {
    // console.log("CLICK " + synthIx + " " + clickR + " " + clickC);
    let synthSeq = gJamState.synthSeqs[synthIx];
    let midiNote = seqRowToMidiNote(synthIx, clickR);
    let stepIx = clickC;
    let seqStep = synthSeq[stepIx];
    seqStepToggleVoiceLifo(seqStep, midiNote); 

    // Update UI
    setSeqStepFromState(synthIx, stepIx); 
    
    if (gSocket !== null) {
        let msg = {
            SynthSeq: {
                synth_ix: synthIx,
                beat_ix: stepIx,
                active_cell_ixs: seqStep.slice(),
                clicked_cell_ix: midiNote
            }
        };
        const jsonMsg = JSON.stringify(msg);
        gSocket.send(jsonMsg);
        console.log("Sent " + jsonMsg);
    }
}

function onSliderChange(synthIx, paramIx, event) {
    if (gSocket !== null) {
        let msg = {
            SynthParam: {
                synth_ix: synthIx,
                param_ix: paramIx,
                value: parseFloat(event.target.value)
            }
        };
        const jsonMsg = JSON.stringify(msg);
        gSocket.send(jsonMsg);
        console.log("Sent " + jsonMsg);
    }
}

function seqRowToMidiNote(synthIx, r) {
    let synthUI = gJamUI.synthUIs[synthIx];
    let noteOffset = (synthUI.numRows - 1) - r;
    return synthUI.startNote + noteOffset;
}

function midiStepToSynthUIBtn(synthIx, stepIx, midiNote) {
    let synthUI = gJamUI.synthUIs[synthIx];
    let noteOffset = midiNote - synthUI.startNote;
    if (noteOffset < 0 || noteOffset >= synthUI.numRows) {
        return null;
    }
    let rowIx = (synthUI.numRows - 1) - noteOffset;
    console.assert(stepIx >= 0)
    console.assert(stepIx < synthUI.numCols);
    return synthUI.seqButtons[rowIx * synthUI.numCols + stepIx];
}

async function initJamSesh(username) {
    gSound = await initSound();

    // Init sound and UI based on initial gJamState
    {
        gMySound = initMySound(); 
        buildJamUI();
    }

    try {
      gSocket = await openSocket();
      // Send username over socket
      let msg = {
        Connect: {
          username: username
        }
      };
      const jsonStr = JSON.stringify(msg);
      gSocket.send(jsonStr);
      console.log("Sent " + jsonStr);
      
    } catch (e) {
      gSocket = null;
    }

    if (gSocket !== null) {
        gSocket.onmessage = onSocketMessage;
    }
}



function onSubmitNameClick() {
    const usernameField = document.getElementById("name");
    const username = usernameField.value;

    let loginElement = document.getElementById("login");
    loginElement.remove();

    initJamSesh(username);
}

const submitNameButton = document.getElementById("submit_name");
submitNameButton.addEventListener("click", onSubmitNameClick);
