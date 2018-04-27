function getSoundData(filename) {
    return new Promise(function(resolve, reject) {
        let request = new XMLHttpRequest();
        request.open('GET', 'http://localhost:8000/' + filename, true);
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
        let osc = audioCtx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start();
        return {
            audioCtx: audioCtx,
            kickSound: decodedSounds[0],
            snareSound: decodedSounds[1],
            synth: {
                osc: osc,
                gain: gainNode
            }
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
        let socket = new WebSocket("ws://localhost:2794", "giogadi");
        socket.onopen = function(e) {
            resolve(socket);
        }
        socket.onerror = function(e) {
            reject();
        }
    });
}

const NUM_BEATS = 16;

function updateStateFromServerMessage(
    uiElements, localState, remoteStates, event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    if (update.update_type === "intro") {
        localState.id = update.client_id;
        remoteStates.length = 0;  // Clear the remoteStates
        for (clientState of update.client_states) {
            if (clientState.client_id === localState.id) {
                if (clientState.sequence.length !=
                    localState.sequence.length) {
                    throw "Mismatch in beat count!";
                }
                if (localState.sequence.length != NUM_BEATS) {
                    throw "wrong # of beats!";
                }
                for (let i = 0; i < NUM_BEATS; i++) {
                    localState.sequence[i] =
                        clientState.sequence[i];
                }
                localState.instrument = clientState.instrument;
            } else {
                remoteStates.push({
                    client_id: clientState.client_id,
                    sequence: clientState.sequence,
                    instrument: clientState.instrument
                });
            }
        }
        updateUiFromState(localState, uiElements);
        return;
    }

    if (localState.id < 0) {
        throw "received server update without being assigned an ID";
    }

    let fromRemoteId = update.client_id;
    if (fromRemoteId === localState.id) {
        throw "received server update from client with same ID as me";
    }
    let knownStateIx = -1;
    for (i = 0; i < remoteStates.length; i++) {
        if (remoteStates[i].client_id === fromRemoteId) {
            knownStateIx = i;
            break;
        }
    }
    if (update.update_type === "disconnect") {
        if (knownStateIx === -1) {
            throw "disconnect message received for unknown client ID";
        }
        // splice removes 1 element, starting at knownStateIx
        remoteStates.splice(knownStateIx, 1);
        console.log("client " + fromRemoteId + " disconnected");
    } else if (update.update_type === "state") {
        let newState = {
            client_id: fromRemoteId,
            sequence: update.client_state.sequence,
            instrument: update.client_state.instrument
        };
        if (knownStateIx === -1) {
            remoteStates.push(newState);
        } else {
            remoteStates[knownStateIx].sequence = update.client_state.sequence;
            remoteStates[knownStateIx].instrument =
                update.client_state.instrument;
        }
        console.log("updated state from client " + fromRemoteId);
    }
}

function getInstrumentNameFromUi(uiElements) {
    let instrument = undefined;
    if (uiElements.kickRadio.checked) {
        instrument = 'kick';
    } else if (uiElements.snareRadio.checked) {
        instrument = 'snare';
    } else if (uiElements.synthRadio.checked) {
        instrument = 'synth';
    }
    return instrument;
}

function sendStateToSocket(socket, localState) {
    let localStateMsg = {
        sequence: localState.sequence,
        instrument: localState.instrument,
    };
    socket.send(JSON.stringify(localStateMsg));
    console.log("Sent instrument " + localStateMsg.instrument);
    console.log("Sent sequence " + localStateMsg.sequence);
}

function onCanvasClick(event, socket, uiElements, localState, remoteStates) {
    const canvasRect = uiElements.canvas.getBoundingClientRect();
    const seqDims = getSequencerDimensions(remoteStates, canvasRect);
    // TODO: figure out how offsetLeft, canvasRect.left, etc. all fit
    // together.
    const x = (event.clientX - uiElements.canvas.offsetLeft) - seqDims.startX;
    const y = (event.clientY - uiElements.canvas.offsetTop) - seqDims.startY;
    console.log(x + " " + y + " " + seqDims.localBeatSize);
    if (x < 0) {
        // Clicked too far to the left
        return;
    }
    if (y < 0) {
        // Clicked too far up
        return;
    }
    if (y >= seqDims.localBeatSize) {
        // Clicked too far down
        return;
    }
    const clickedBeatIx = Math.floor(x / seqDims.localBeatSize);
    if (clickedBeatIx >= NUM_BEATS) {
        // Clicked too far to the right
        return;
    }
    localState.sequence[clickedBeatIx] = !localState.sequence[clickedBeatIx];
    sendStateToSocket(socket, localState);
}

// TODO: Currently, state update and updates out to server are
// coupled; maybe separate them?
function setupServerEvents(uiElements, localState, remoteStates) {
    openSocket().then(function(socket) {
        socket.onmessage =
            event => updateStateFromServerMessage(
                uiElements, localState, remoteStates, event);
        let onRadioChange = function(e) {
            localState.instrument = getInstrumentNameFromUi(uiElements);
            sendStateToSocket(socket, localState);
        }
        uiElements.kickRadio.onchange = onRadioChange;
        uiElements.snareRadio.onchange = onRadioChange;
        uiElements.synthRadio.onchange = onRadioChange;
        uiElements.canvas.onclick =
            e => onCanvasClick(
                event, socket, uiElements, localState, remoteStates)
    });
}

function getInstrumentSound(audio, instrumentName) {
    let sound = null;
    if (instrumentName === "kick") {
        sound = audio.kickSound;
    } else if (instrumentName === "snare") {
        sound = audio.snareSound;
    }
    return sound;
}

function playBeat(beatIndex, sequence, audio, instrumentName) {
    if (sequence[beatIndex]) {
        if (instrumentName === 'synth') {
            audio.synth.gain.gain.linearRampToValueAtTime(
                1, audio.audioCtx.currentTime + 0.01);
            audio.synth.gain.gain.linearRampToValueAtTime(
                0, audio.audioCtx.currentTime + 0.1);
        } else {
            playSoundFromBuffer(
                audio.audioCtx, getInstrumentSound(audio, instrumentName));
        }
    }
}

function perBeat(audio, playbackState, localState, remoteStates) {
    playBeat(playbackState.beatIndex, localState.sequence,
             audio, localState.instrument);
    // TODO: Might need multiple synths for multiple remotes.
    for (state of remoteStates) {
        playBeat(playbackState.beatIndex, state.sequence,
                 audio, state.instrument);
    }
}

function togglePlayPause(
    playbackState, audio, localState, remoteStates) {
    if (playbackState.playIntervalId === null) {
        const bpm = 240;
        const ticksPerBeat = (1 / bpm) * 60 * 1000;
        // By default, setInterval doesn't invoke the function for the
        // first time until after the interval duration; we want
        // playback to start as soon as the user hits play, so we
        // manually invoke the playback function once.
        perBeat(audio, playbackState, localState, remoteStates);
        playbackState.playIntervalId =
            window.setInterval(function() {
                // We have to increment the beatIndex right at the
                // beginning of the "iteration" because other parts
                // (like UI) use beatIndex, and so beatIndex needs to
                // correspond to the "actual" beatIndex for the entire
                // iteration.
                playbackState.beatIndex =
                    (playbackState.beatIndex + 1) % NUM_BEATS;
                perBeat(audio, playbackState, localState, remoteStates);
            },
                               /*delay=*/ticksPerBeat);
    } else {
        window.clearInterval(playbackState.playIntervalId);
        playbackState.playIntervalId = null;
        playbackState.beatIndex = 0;
    }
}

function drawSequence(
    context2d, startX, startY, sequence, beatSize, playbackState) {
    context2d.strokeStyle = 'rgb(0, 0, 0)';
    // Draw our beatboxes, where inactive beats are grey and active
    // beats are red.
    for (let beatIx = 0; beatIx < NUM_BEATS; beatIx++) {
        if (sequence[beatIx]) {
            context2d.fillStyle = 'rgb(200, 0, 0)';
        } else {
            context2d.fillStyle = 'rgb(100, 100, 100)';
        }
        const minX = startX + beatIx * beatSize;
        const minY = startY;
        context2d.fillRect(
            /*x=*/minX, /*y=*/minY, /*w=*/beatSize, /*h=*/beatSize);
        context2d.strokeRect(minX, minY, beatSize, beatSize);
        // TODO: don't use playIntervalId to represent play/pause.
        if (playbackState.playIntervalId !== null &&
            beatIx === playbackState.beatIndex) {
            context2d.fillStyle = 'rgba(0, 255, 0, 0.5)';
            context2d.fillRect(minX, minY, beatSize, beatSize);
        }
    }
}

function getSequencerDimensions(remoteStates, canvasRect) {
    const w = canvasRect.width;
    const h = canvasRect.height;
    const spacing = 30;
    const startX = 0;
    const startY = 0;
    // We need to find an appropriate size for the component beat
    // boxes of the local client sequencer and the remote clients'
    // sequencers. We want the local sequencer to be 2x as large as
    // the remote states' sequencers. We also need to account for
    // vertical between sequencers, and the height of the drawing
    // canvas.
    //
    // We want: startY + localBeatSize + numRemotes*(spacing+0.5*localBeatSize)
    // <= height.
    let localBeatSize = Math.floor(
        ((h - startY) - remoteStates.length * spacing) /
            (1 + 0.5*remoteStates.length));
    // Want startX + localBeatSize * NUM_BEATS <= w
    localBeatSize = Math.min(localBeatSize,
                             Math.floor((w - startX) / NUM_BEATS));
    const remoteBeatSize = Math.floor(localBeatSize / 2);
    return {
        localBeatSize: localBeatSize,
        remoteBeatSize: remoteBeatSize,
        startX: startX,
        startY: startY,
        spacing: spacing
    };
}

function drawInterface(localState, remoteStates, uiElements, playbackState) {
    const canvasRect = uiElements.canvas.getBoundingClientRect();
    const seqDims =
          getSequencerDimensions(remoteStates, canvasRect);
    // Clear the canvas
    let ctx = uiElements.canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasRect.width, canvasRect.height);
    // Draw local sequence
    drawSequence(ctx, seqDims.startX, seqDims.startY, localState.sequence,
                 seqDims.localBeatSize, playbackState);
    // Draw remote sequences
    for (let remoteIx = 0; remoteIx < remoteStates.length; remoteIx++) {
        const startX = seqDims.startX;
        const startY = seqDims.startY + seqDims.localBeatSize +
              seqDims.spacing +
              remoteIx * (seqDims.spacing + seqDims.remoteBeatSize);
        drawSequence(ctx, startX, startY, remoteStates[remoteIx].sequence,
                     seqDims.remoteBeatSize, playbackState);
    }
}

function initUi(localState, remoteStates, uiElements, playbackState) {
    let kickRadio = document.createElement('input');
    kickRadio.setAttribute('type', 'radio');
    kickRadio.setAttribute('name', 'instrument');
    kickRadio.setAttribute('value', 'kick');
    uiElements.kickRadio = document.body.appendChild(kickRadio);

    let snareRadio = document.createElement('input');
    snareRadio.setAttribute('type', 'radio');
    snareRadio.setAttribute('name', 'instrument');
    snareRadio.setAttribute('value', 'snare');
    uiElements.snareRadio = document.body.appendChild(snareRadio);

    let synthRadio = document.createElement('input');
    synthRadio.setAttribute('type', 'radio');
    synthRadio.setAttribute('name', 'instrument');
    synthRadio.setAttribute('value', 'synth');
    uiElements.synthRadio = document.body.appendChild(synthRadio);

    updateUiFromState(localState, uiElements);

    document.body.appendChild(document.createElement('br'));

    let canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'interface');
    canvas.setAttribute('height', '600');
    uiElements.canvas = document.body.appendChild(canvas);

    function draw() {
        drawInterface(localState, remoteStates, uiElements, playbackState);
        window.requestAnimationFrame(draw);
    }
    window.requestAnimationFrame(draw);
}

function updateUiFromState(localState, uiElements) {
    if (localState.instrument === "kick") {
        uiElements.kickRadio.checked = true;
    } else if (localState.instrument === "snare") {
        uiElements.snareRadio.checked = true;
    } else if (localState.instrument === "synth") {
        uiElements.synthRadio.checked = true;
    }
}

function init() {
    let localState = {
        sequence: [],
        instrument: "kick",
        id: -1
    };
    let playbackState = {
        playIntervalId: null,
        beatIndex: 0
    };
    for (let i = 0; i < NUM_BEATS; i++) {
        localState.sequence[i] = false;
    }
    let uiElements = {
        kickRadio: null,
        snareRadio: null,
        canvas: null,
    };
    let remoteStates = [];
    initUi(localState, remoteStates, uiElements, playbackState);
    setupServerEvents(uiElements, localState, remoteStates);
    initSounds().then(function(audio) {
        function keyCallback(event) {
            if (event.key === " " ||
                event.key === "SpaceBar") {
                togglePlayPause(playbackState, audio, localState, remoteStates);
            }
        }
        document.addEventListener('keydown', keyCallback);
    });
}

init();
