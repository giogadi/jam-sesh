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

function initSound() {
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

function perBeat(audio, synthSequence, drumSequence, beatIndex) {
    const noteIx = synthSequence[beatIndex];
    if (noteIx >= 0) {
        audio.synth.osc.frequency.setValueAtTime(
            noteFrequency(noteIx), audio.audioCtx.currentTime);
        audio.synth.gain.gain.linearRampToValueAtTime(
            1, audio.audioCtx.currentTime + 0.01);
        audio.synth.gain.gain.linearRampToValueAtTime(
            0, audio.audioCtx.currentTime + 0.1);
    }

    const drumIx = drumSequence[beatIndex];
    if (drumIx >= 0) {
        if (drumIx >= audio.drumSounds.length) {
            throw "ERROR: bad drum ix " + drumIx;
        }
        playSoundFromBuffer(audio.audioCtx, audio.drumSounds[drumIx]);
    }
}

// JamModel method
function stop() {
    if (this.playback.playIntervalId !== null) {
        window.clearInterval(this.playback.playIntervalId);
        this.playback.playIntervalId = null;
        this.playback.beatIndex = 0;
        this.stateChange(
            -1, this.synthSequence, this.drumSequence, this.playback.bpm);
    }
}

// JamModel method
function pause() {
    if (this.playback.playIntervalId !== null) {
        window.clearInterval(this.playback.playIntervalId);
        this.playback.playIntervalId = null;
        this.stateChange(
            -1, this.synthSequence, this.drumSequence, this.playback.bpm);
    }
}

// JamModel method
function play() {
    // If we are still waiting for audio to load, don't start
    // playback.
    if (this.audio === null) {
        return;
    }

    if (this.playback.playIntervalId !== null) {
        return;
    }

    const ticksPerBeat = (1 / this.playback.bpm) * 60 * 1000;
    // By default, setInterval doesn't invoke the function for the
    // first time until after the interval duration; we want
    // playback to start as soon as the user hits play, so we
    // manually invoke the playback function once.
    perBeat(this.audio, this.synthSequence, this.drumSequence,
            this.playback.beatIndex);
    this.stateChange(this.playback.beatIndex,
                     this.synthSequence, this.drumSequence,
                     this.playback.bpm);
    let beatFn = function beatFn() {
        // We have to increment the beatIndex right at the
        // beginning of the "iteration" because other parts
        // (like UI) use beatIndex, and so beatIndex needs to
        // correspond to the "actual" beatIndex for the entire
        // iteration.
        //
        // TODO: This assumes all sequences have same length.
        this.playback.beatIndex =
            (this.playback.beatIndex + 1) %
            this.synthSequence.length;
        this.stateChange(this.playback.beatIndex,
                         this.synthSequence,
                         this.drumSequence,
                         this.playback.bpm);
        perBeat(this.audio, this.synthSequence, this.drumSequence,
                this.playback.beatIndex);
    };
    this.playback.playIntervalId =
        window.setInterval(beatFn.bind(this), /*delay=*/ticksPerBeat);
}

// JamModel method
function togglePlayPause() {
    if (this.playback.playIntervalId === null) {
        play.bind(this)();
    } else {
        stop.bind(this)();
    }
}

// JamModel method
function changeBpm(newBpm) {
    console.log("new bpm: " + newBpm);
    pause.bind(this)();
    this.playback.bpm = newBpm;
    play.bind(this)();
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

function sendStateToSocket(socket, synthSequence, drumSequence) {
    let stateMsg = {
        synth_sequence: synthSequence,
        drum_sequence: drumSequence,
    };
    const stateMsgStr = JSON.stringify(stateMsg);
    socket.send(stateMsgStr);
    console.log("Sent " + stateMsgStr);
}

// Method of JamModel
function updateStateFromSocketEvent(event) {
    let update = JSON.parse(event.data);
    console.log("Received message " + JSON.stringify(update));
    this.synthSequence = update.synth_sequence.slice();
    this.drumSequence = update.drum_sequence.slice();
    this.stateChange(this.playback.playIntervalId === null
                     ? -1 : this.playback.beatIndex,
                     this.synthSequence,
                     this.drumSequence,
                     this.playback.bpm);
}

// Method of JamModel
function onSocketOpen(socket) {
    this.sendStateToServer = function () {
        sendStateToSocket(socket, this.synthSequence, this.drumSequence);
    }
    socket.onmessage = updateStateFromSocketEvent.bind(this);
}

let JamModel = function JamModel() {
    let setAudio = function setAudio(audio) {
        this.audio = audio;
    }
    initSound().then(setAudio.bind(this));
    this.synthSequence = [];
    this.drumSequence = [];
    this.playback = {
        playIntervalId: null,
        beatIndex: 0,
        bpm: 240,
    }
    this.stateChange = function(beatIndex, synthSequence, drumSequence, bpm) { };
    this.togglePlayback = togglePlayPause.bind(this);
    this.sendStateToServer = function () { };
    this.updateSynthSequence = function updateSynthSequence(beatIx, noteIx) {
        this.synthSequence[beatIx] = noteIx;
        this.stateChange(this.playback.playIntervalId === null
                         ? -1 : this.playback.beatIndex,
                         this.synthSequence, this.drumSequence,
                         this.playback.bpm);
        this.sendStateToServer();
    }
    this.updateDrumSequence = function updateDrumSequence(beatIx, noteIx) {
        this.drumSequence[beatIx] = noteIx;
        this.stateChange(this.playback.playIntervalId === null
                         ? -1 : this.playback.beatIndex,
                         this.synthSequence, this.drumSequence,
                         this.playback.bpm);
        this.sendStateToServer();
    }

    const NUM_BEATS = 16;
    for (let i = 0; i < NUM_BEATS; i++) {
        this.synthSequence.push(-1);
        this.drumSequence.push(-1);
    }
    this.forceStateUpdate = function forceStateUpdate() {
        this.stateChange(this.playback.playIntervalId === null
                         ? -1 : this.playback.beatIndex,
                         this.synthSequence, this.drumSequence,
                         this.playback.bpm);
    };

    openSocket().then(onSocketOpen.bind(this),
                      e => console.log("socket connection failed: " + e));
}
