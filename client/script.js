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

function updateStateFromServerMessage(state, event) {
    let newState = JSON.parse(event.data);
    // TODO can we just do state = newState?
    console.log("new remote instrument: " + newState.instrument);
    console.log("new remote sequence: " + newState.sequence);
    state.instrument = newState.instrument;
    state.sequence = newState.sequence;
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
        // TODO does order matter?
        sequence: localState.beatBoxes.map(b => b.checked),
        instrument: getInstrumentNameFromLocalState(localState)
    };
    socket.send(JSON.stringify(localStateMsg));
    console.log("Sent instrument " + localStateMsg.instrument);
    console.log("Sent sequence " + localStateMsg.sequence);
}

function setupServerEvents(localState, remoteState) {
    openSocket().then(function(socket) {
        socket.onmessage =
            event => updateStateFromServerMessage(remoteState, event);
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

const NUM_BEATS = 16;

function perBeat(audio, playbackState, localState, remoteState) {
    localSequence = localState.beatBoxes.map(b => b.checked);
    playBeat(playbackState.beatIndex, localSequence,
             audio.audioCtx,
             getInstrumentSound(
                 audio,
                 getInstrumentNameFromLocalState(localState)));
    playBeat(playbackState.beatIndex, remoteState.sequence,
             audio.audioCtx,
             getInstrumentSound(audio, remoteState.instrument));
    playbackState.beatIndex = (playbackState.beatIndex + 1) % NUM_BEATS;
}

function togglePlayPause(playbackState, audio, localState, remoteState) {
    if (playbackState.playIntervalId === null) {
        const bpm = 240;
        const ticksPerBeat = (1 / bpm) * 60 * 1000;
        // By default, setInterval doesn't invoke the function for the
        // first time until after the interval duration; we want
        // playback to start as soon as the user hits play, so we
        // manually invoke the playback function once.
        perBeat(audio, playbackState, localState, remoteState);
        playbackState.playIntervalId =
            window.setInterval(function() {
                perBeat(audio, playbackState, localState, remoteState)
            },
                               /*delay=*/ticksPerBeat);
    } else {
        window.clearInterval(playbackState.playIntervalId);
        playbackState.playIntervalId = null;
        playbackState.beatIndex = 0;
    }
}

function init() {
    let localState = {
        beatBoxes: [],
        kickRadio: null,
        snareRadio: null
    };
    for (i = 0; i < NUM_BEATS; i++) {
        let checkBox = document.createElement('input');
        checkBox.setAttribute('type', 'checkbox');
        checkBox.checked = i % 4 === 0;
        localState.beatBoxes.push(document.body.appendChild(checkBox));
    }
    let kickRadio = document.createElement('input');
    kickRadio.setAttribute('type', 'radio');
    kickRadio.setAttribute('name', 'instrument');
    kickRadio.setAttribute('value', 'kick');
    kickRadio.checked = true;
    localState.kickRadio = document.body.appendChild(kickRadio);

    let snareRadio = document.createElement('input');
    snareRadio.setAttribute('type', 'radio');
    snareRadio.setAttribute('name', 'instrument');
    snareRadio.setAttribute('value', 'snare');
    localState.snareRadio = document.body.appendChild(snareRadio);

    let remoteState = {
        sequence: [],
        instrument: 'kick'
    };
    for (i = 0; i < NUM_BEATS; i++) {
        remoteState.sequence.push(false);
    }
    setupServerEvents(localState, remoteState);
    let playbackState = {
        playIntervalId: null,
        beatIndex: 0
    };
    initSounds().then(function(audio) {
        function keyCallback(event) {
            if (event.key === " " ||
                event.key === "SpaceBar") {
                togglePlayPause(playbackState, audio, localState, remoteState);
            }
        }
        document.addEventListener('keydown', keyCallback);
    });
}

init();
