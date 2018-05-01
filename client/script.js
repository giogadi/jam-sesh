function getSoundData(filename) {
    return new Promise(function(resolve, reject) {
        let request = new XMLHttpRequest();
        request.open(
            'GET', 'http://' + window.location.hostname + ":2794/" + filename);
        request.responseType = 'arraybuffer';
        request.onload = function() {
            resolve(request.response);
        }
        request.onerror = function() {
            reject(request.statusText);
        }
        request.send();
    });
}

const BASE_FREQS = [
    55.0000, // A
    58.2705, // A#
    61.7354, // B
    65.4064, // C
    69.2957, // C#
    73.4162, // D
    77.7817, // D#
    82.4069, // E
    87.3071, // F
    92.4986, // F#
    97.9989, // G
    103.826, // G#
];

// Maximum note index is arbitrarily 70. Who cares.
const MAX_NOTE_INDEX = 70;

function noteFrequency(note_ix) {
    if (note_ix > MAX_NOTE_INDEX || note_ix < 0) {
        throw "invalid note index (" + note_ix + ")";
    }
    const base_freq_ix = note_ix % BASE_FREQS.length;
    const num_octaves_above = Math.floor(note_ix / BASE_FREQS.length);
    return BASE_FREQS[base_freq_ix] * (1 << num_octaves_above);
}

function initSynth(audioCtx) {
    let osc = audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, audioCtx.currentTime);
    gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    return {
        osc: osc,
        gain: gainNode
    };
}

function initSounds() {
    let soundNames = ['kick', 'snare'];
    let sounds = soundNames.map(function(soundName) {
        return getSoundData(soundName + '.wav')
    });
    let audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return Promise.all(sounds).then(function(loadedSounds) {
        return Promise.all(loadedSounds.map(function(loadedSound) {
            return audioCtx.decodeAudioData(loadedSound);
        }));
    }).then(function(decodedSounds) {
        return {
            audioCtx: audioCtx,
            drumSounds: decodedSounds,
            synth: initSynth(audioCtx)
        }
    });
}

function playSoundFromBuffer(audioCtx, buffer) {
    let source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
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
            reject();
        }
    });
}

// function updateStateFromServerMessage(
//     uiElements, localState, remoteStates, event) {
//     let update = JSON.parse(event.data);
//     console.log("Received message " + JSON.stringify(update));
//     if (update.update_type === "intro") {
//         localState.id = update.client_id;
//         remoteStates.length = 0;  // Clear the remoteStates
//         for (clientState of update.client_states) {
//             if (clientState.client_id === localState.id) {
//                 if (clientState.sequence.length !=
//                     localState.sequence.length) {
//                     throw "Mismatch in beat count!";
//                 }
//                 if (localState.sequence.length != NUM_BEATS) {
//                     throw "wrong # of beats!";
//                 }
//                 for (let i = 0; i < NUM_BEATS; i++) {
//                     localState.sequence[i] =
//                         clientState.sequence[i];
//                 }
//                 localState.instrument = clientState.instrument;
//             } else {
//                 remoteStates.push({
//                     client_id: clientState.client_id,
//                     sequence: clientState.sequence,
//                     instrument: clientState.instrument
//                 });
//             }
//         }
//         updateUiFromState(localState, uiElements);
//         return;
//     }

//     if (localState.id < 0) {
//         throw "received server update without being assigned an ID";
//     }

//     let fromRemoteId = update.client_id;
//     if (fromRemoteId === localState.id) {
//         throw "received server update from client with same ID as me";
//     }
//     let knownStateIx = -1;
//     for (i = 0; i < remoteStates.length; i++) {
//         if (remoteStates[i].client_id === fromRemoteId) {
//             knownStateIx = i;
//             break;
//         }
//     }
//     if (update.update_type === "disconnect") {
//         if (knownStateIx === -1) {
//             throw "disconnect message received for unknown client ID";
//         }
//         // splice removes 1 element, starting at knownStateIx
//         remoteStates.splice(knownStateIx, 1);
//         console.log("client " + fromRemoteId + " disconnected");
//     } else if (update.update_type === "state") {
//         let newState = {
//             client_id: fromRemoteId,
//             sequence: update.client_state.sequence,
//             instrument: update.client_state.instrument
//         };
//         if (knownStateIx === -1) {
//             remoteStates.push(newState);
//         } else {
//             remoteStates[knownStateIx].sequence = update.client_state.sequence;
//             remoteStates[knownStateIx].instrument =
//                 update.client_state.instrument;
//         }
//         console.log("updated state from client " + fromRemoteId);
//     }
// }

// function sendStateToSocket(socket, localState) {
//     let localStateMsg = {
//         sequence: localState.sequence,
//         instrument: localState.instrument,
//     };
//     socket.send(JSON.stringify(localStateMsg));
//     console.log("Sent instrument " + localStateMsg.instrument);
//     console.log("Sent sequence " + localStateMsg.sequence);
// }

function onCanvasClick(event, uiElements, localState) {
    const canvasRect = uiElements.canvas.getBoundingClientRect();
    const seqDims = getSequencerDimensions(canvasRect, localState.numBeats);
    // TODO: figure out how offsetLeft, canvasRect.left, etc. all fit
    // together.
    const x = (event.clientX - uiElements.canvas.offsetLeft) - seqDims.startX;
    const y = (event.clientY - uiElements.canvas.offsetTop) - seqDims.startY;
    console.log(x + " " + y + " " + seqDims.beatSize);
    if (x < 0) {
        // Clicked too far to the left
        return;
    }
    if (y < 0) {
        // Clicked too far up
        return;
    }
    const clickedBeatIx = Math.floor(x / seqDims.beatSize);
    if (clickedBeatIx >= localState.numBeats) {
        // Clicked too far to the right
        return;
    }
    const clickedNoteRow = Math.floor(y / seqDims.beatSize);
    if (clickedNoteRow >= NUM_NOTES) {
        // Clicked too far down
        return;
    }
    const clickedNoteIx = (NUM_NOTES - 1) - clickedNoteRow;
    // If user clicked on the currently active note, then deactivate
    // that beat. Otherwise, change this beat to the clicked note.
    let sequence = localState.gearState.synthSequence;
    if (sequence[clickedBeatIx] === clickedNoteIx) {
        sequence[clickedBeatIx] = -1;
    } else {
        sequence[clickedBeatIx] = clickedNoteIx;
    }
}

// TODO: Currently, state update and updates out to server are
// coupled; maybe separate them?
// function setupServerEvents(uiElements, localState, remoteStates) {
//     openSocket().then(function(socket) {
//         socket.onmessage =
//             event => updateStateFromServerMessage(
//                 uiElements, localState, remoteStates, event);
//         let onInstrumentChange = function(e) {
//             localState.instrument = e.target.value;
//             sendStateToSocket(socket, localState);
//         }
//         uiElements.instrumentSelect.onchange = onInstrumentChange;
//         uiElements.canvas.onclick =
//             e => onCanvasClick(
//                 event, socket, uiElements, localState, remoteStates)
//         uiElements.clearButton.onclick = function() {
//             for (let i = 0; i < localState.sequence.length; i++) {
//                 localState.sequence[i] = -1;
//             }
//             sendStateToSocket(socket, localState);
//         }
//     });
// }

function perBeat(audio, localState) {
    const beatIndex = localState.playbackState.beatIndex;
    const soundIndex = localState.gearState.synthSequence[beatIndex];
    const noteIndex = soundIndex + 24;
    audio.synth.osc.frequency.setValueAtTime(
        noteFrequency(noteIndex), audio.audioCtx.currentTime);
    audio.synth.gain.gain.linearRampToValueAtTime(
        1, audio.audioCtx.currentTime + 0.01);
    audio.synth.gain.gain.linearRampToValueAtTime(
        0, audio.audioCtx.currentTime + 0.1);
}

function togglePlayPause(localState, audio) {
    if (localState.playbackState.playIntervalId === null) {
        const ticksPerBeat = (1 / localState.bpm) * 60 * 1000;
        // By default, setInterval doesn't invoke the function for the
        // first time until after the interval duration; we want
        // playback to start as soon as the user hits play, so we
        // manually invoke the playback function once.
        perBeat(audio, localState);
        localState.playbackState.playIntervalId =
            window.setInterval(function() {
                // We have to increment the beatIndex right at the
                // beginning of the "iteration" because other parts
                // (like UI) use beatIndex, and so beatIndex needs to
                // correspond to the "actual" beatIndex for the entire
                // iteration.
                localState.playbackState.beatIndex =
                    (localState.playbackState.beatIndex + 1) %
                    localState.numBeats;
                perBeat(audio, localState);
            },
                               /*delay=*/ticksPerBeat);
    } else {
        window.clearInterval(localState.playbackState.playIntervalId);
        localState.playbackState.playIntervalId = null;
        localState.playbackState.beatIndex = 0;
    }
}

const NUM_NOTES = 13;

function drawSequence(
    context2d, startX, startY, sequence, numBeats, beatSize, playbackState) {
    // Draw our beatboxes, where inactive beats are grey and active
    // beats are red.
    //
    // First draw the gray inactive beats as one big rectangle.
    context2d.fillStyle = 'rgb(100, 100, 100)';
    context2d.fillRect(startX, startY,
                       beatSize * numBeats, beatSize * NUM_NOTES);
    // Now draw the active beats on the appropriate note row.
    context2d.fillStyle = 'rgb(200, 0, 0)';
    for (let beatIx = 0; beatIx < numBeats; beatIx++) {
        if (sequence[beatIx] < 0) {
            continue;
        }
        const noteIx = sequence[beatIx];
        const noteRow = (NUM_NOTES - 1) - noteIx;
        context2d.fillRect(
            startX + beatIx * beatSize,
            startY + noteRow * beatSize,
            beatSize, beatSize);
    }
    // If playback is on, we highlight the current beat in green.
    //
    // TODO: don't use playIntervalId to represent play/pause.
    if (playbackState.playIntervalId !== null) {
        context2d.fillStyle = 'rgba(0, 255, 0, 0.5)';
        const beatIx = playbackState.beatIndex;
        context2d.fillRect(
            startX + beatIx * beatSize,
            startY,
            beatSize, NUM_NOTES * beatSize);
    }
    // Finally, draw a grid to divide up the beats and notes.
    context2d.strokeStyle = 'rgb(0, 0, 0)';
    for (let lineIx = 0; lineIx <= numBeats; lineIx++) {
        context2d.beginPath();
        const x = startX + lineIx * beatSize;
        context2d.moveTo(x, startY);
        context2d.lineTo(x, startY + NUM_NOTES * beatSize);
        context2d.stroke();
    }
    for (let lineIx = 0; lineIx <= NUM_NOTES; lineIx++) {
        context2d.beginPath();
        const y = startY + lineIx * beatSize;
        context2d.moveTo(startX, y);
        context2d.lineTo(startX + numBeats * beatSize, y);
        context2d.stroke();
    }
}

function getSequencerDimensions(canvasRect, numBeats) {
    const w = canvasRect.width;
    const h = canvasRect.height;
    const startX = 0;
    const startY = 0;
    // Want startX + beatSize * numBeats <= w &&
    // startY + numNotes*beatSize <= h.
    let beatSize = Math.floor((w - startX) / numBeats);
    beatSize = Math.min(beatSize,
                        Math.floor((h - startY) / NUM_NOTES));
    return {
        beatSize: beatSize,
        startX: startX,
        startY: startY,
    };
}

function drawInterface(localState, uiElements) {
    // TODO: draw single-line sequence for the drums
    const canvasRect = uiElements.canvas.getBoundingClientRect();
    const seqDims =
          getSequencerDimensions(canvasRect, localState.numBeats);
    // Clear the canvas
    let ctx = uiElements.canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasRect.width, canvasRect.height);
    ctx.fillStyle = 'rgb(200, 200, 200)';
    ctx.fillRect(0, 0, canvasRect.width, canvasRect.height);
    // Draw local sequence
    drawSequence(ctx, seqDims.startX, seqDims.startY,
                 localState.gearState.synthSequence, localState.numBeats,
                 seqDims.beatSize, localState.playbackState);
}

function initUi(localState) {
    let uiElements = {
        playButton: null,
        canvas: null,
    };

    let playButton = document.createElement('button');
    playButton.setAttribute('type', 'button');
    playButton.innerHTML = "Play/Stop";
    uiElements.playButton = document.body.appendChild(playButton);

    document.body.appendChild(document.createElement('br'));

    let canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'interface');
    canvas.setAttribute('height', '600');
    uiElements.canvas = document.body.appendChild(canvas);
    uiElements.canvas.onclick =
        e => onCanvasClick(e, uiElements, localState);

    function draw() {
        drawInterface(localState, uiElements);
        window.requestAnimationFrame(draw);
    }
    window.requestAnimationFrame(draw);

    return uiElements;
}

// function updateUiFromState(localState, uiElements) {
//     // TODO: there's gotta be a better way to do this, ugh.
//     const options = uiElements.instrumentSelect.options;
//     for (let optionIx = 0; optionIx < options.length; optionIx++) {
//         if (options[optionIx].value === localState.instrument) {
//             uiElements.instrumentSelect.selectedIndex = optionIx;
//             break;
//         }
//     }
// }

function init() {
    const NUM_BEATS = 16;
    const BPM = 240;
    let localState = {
        gearState: {
            synthSequence: [],
        },
        playbackState: {
            playIntervalId: null,
            beatIndex: 0
        },
        numBeats: NUM_BEATS,
        bpm: BPM,
        id: -1
    };
    for (let i = 0; i < localState.numBeats; i++) {
        localState.gearState.synthSequence[i] = 0;
    }
    let uiElements = initUi(localState);
    // setupServerEvents(uiElements, localState, remoteStates);
    initSounds().then(function(audio) {
        function keyCallback(event) {
            if (event.key === " " ||
                event.key === "SpaceBar") {
                togglePlayPause(localState, audio);
            }
        }
        document.addEventListener('keydown', keyCallback);
        uiElements.playButton.onclick = e => {
            togglePlayPause(localState, audio);
        }
    });
}

init();
