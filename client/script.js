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
    }).then(function(decodedSounds) {;
        return {
            audioCtx: audioCtx,
            kickSound: decodedSounds[0],
            snareSound: decodedSounds[1]
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
    localState, remoteStates, event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    if (update.update_type === "intro") {
        localState.id = update.client_id;
        remoteStates.length = 0;  // Clear the remoteStates
        for (client_state of update.client_states) {
            if (client_state.client_id === localState.id) {
                if (client_state.sequence.length !=
                    localState.beatBoxes.length) {
                    throw "Mismatch in beat count!";
                }
                if (localState.beatBoxes.length != NUM_BEATS) {
                    throw "wrong # of beats!";
                }
                for (let i = 0; i < NUM_BEATS; i++) {
                    localState.beatBoxes[i].checked =
                        client_state.sequence[i];
                }
                localState.instrument = client_state.instrument;
            } else {
                remoteStates.push({
                    client_id: client_state.client_id,
                    sequence: client_state.sequence,
                    instrument: client_state.instrument
                });
            }
        }
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

function getInstrumentNameFromLocalState(localState) {
    let instrument = undefined;
    if (localState.kickRadio.checked) {
        instrument = 'kick';
    } else if (localState.snareRadio.checked) {
        instrument = 'snare';
    }
    return instrument;
}

function onBeatBoxChange(event, socket, localState) {
    let localStateMsg = {
        sequence: localState.beatBoxes.map(b => b.checked),
        instrument: getInstrumentNameFromLocalState(localState)
    };
    socket.send(JSON.stringify(localStateMsg));
    console.log("Sent instrument " + localStateMsg.instrument);
    console.log("Sent sequence " + localStateMsg.sequence);
}

function setupServerEvents(localState, remoteStates) {
    openSocket().then(function(socket) {
        socket.onmessage =
            event => updateStateFromServerMessage(
                localState, remoteStates, event);
        for (b of localState.beatBoxes) {
            b.onchange = e =>
                onBeatBoxChange(e, socket, localState);
        }
        localState.kickRadio.onchange =
            e => onBeatBoxChange(e, socket, localState);
        localState.snareRadio.onchange =
            e => onBeatBoxChange(e, socket, localState);
    });
}

function playBeat(beatIndex, sequence, audioCtx, sound) {
    if (sequence[beatIndex]) {
        playSoundFromBuffer(audioCtx, sound);
    }
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

function perBeat(audio, playbackState, localState, remoteStates) {
    localSequence = localState.beatBoxes.map(b => b.checked);
    playBeat(playbackState.beatIndex, localSequence,
             audio.audioCtx,
             getInstrumentSound(
                 audio,
                 getInstrumentNameFromLocalState(localState)));
    for (state of remoteStates) {
        playBeat(playbackState.beatIndex, state.sequence,
                 audio.audioCtx,
                 getInstrumentSound(audio, state.instrument));
    }
    playbackState.beatIndex = (playbackState.beatIndex + 1) % NUM_BEATS;
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
                perBeat(audio, playbackState, localState, remoteStates);
            },
                               /*delay=*/ticksPerBeat);
    } else {
        window.clearInterval(playbackState.playIntervalId);
        playbackState.playIntervalId = null;
        playbackState.beatIndex = 0;
    }
}

function initUi(numBeats) {
    let uiState = {
        beatBoxes: [],
        kickRadio: null,
        snareRadio: null,
        // TODO: Pls. This is terrible and doesn't belong here.
        id: -1
    }
    for (i = 0; i < numBeats; i++) {
        let checkBox = document.createElement('input');
        checkBox.setAttribute('type', 'checkbox');
        uiState.beatBoxes.push(document.body.appendChild(checkBox));
    }
    let kickRadio = document.createElement('input');
    kickRadio.setAttribute('type', 'radio');
    kickRadio.setAttribute('name', 'instrument');
    kickRadio.setAttribute('value', 'kick');
    kickRadio.checked = true;
    uiState.kickRadio = document.body.appendChild(kickRadio);

    let snareRadio = document.createElement('input');
    snareRadio.setAttribute('type', 'radio');
    snareRadio.setAttribute('name', 'instrument');
    snareRadio.setAttribute('value', 'snare');
    uiState.snareRadio = document.body.appendChild(snareRadio);

    return uiState;
}

function init() {
    let localState = initUi(NUM_BEATS);
    let remoteStates = [];
    setupServerEvents(localState, remoteStates, NUM_BEATS);
    let playbackState = {
        playIntervalId: null,
        beatIndex: 0
    };
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
