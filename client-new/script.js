"use strict";

import {initSound, initSynth, disconnectSynth} from './sound.js'

function createElementAsChild(parentElement, tagName) {
    let child = document.createElement(tagName);
    return parentElement.appendChild(child);
}

let gSound = null;
let gSocket = null;
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

// init gJamState
{
    gJamState = {
        synthSeqs: [
            createEmptySeq(16, 1),
            createEmptySeq(16, 1)
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
                    synthSeqs: incomingMsg.synth_sequences
                };
            }

            gMySound = initMySound(); 
            buildJamUI(); 

            gHasReceivedState = true;
        } 

        return;
    }

    // NOT A SYNC MESSAGE

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

function setUIFromState() {
    const numSynths = gJamState.synthSeqs.length;
    for (let synthIx = 0; synthIx < numSynths; ++synthIx) {
        let seq = gJamState.synthSeqs[synthIx];
        let synthUI = gJamUI.synthUIs[synthIx]   
        for (let stepIx = 0; stepIx < seq.length; ++stepIx) {
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
    }
}

function buildSynthUI(rootNode, synthIx) {
    let synthSeq = gJamState.synthSeqs[synthIx];
    // let numRows = stateSync.num_synth_note_rows;
    let numRows = 14;
    let numCols = synthSeq.length;
    let numVoices = synthSeq[0].length; 

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
            seqButtons.push(btn);
        }
    }

    return {
        numRows: numRows,
        numCols: numCols,
        startNote: 60, // C4
        seqButtons: seqButtons
    };
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
