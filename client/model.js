// Maximum note index is arbitrarily 70. Who cares.
const MAX_NOTE_INDEX = 70;

const NUM_BEATS = 16;
const NUM_SYNTH_VOICES = 2;
const NUM_DRUM_VOICES = 2;

function noteFrequency(note_ix) {
    if (note_ix > MAX_NOTE_INDEX || note_ix < 0) {
        throw "invalid note index (" + note_ix + ")";
    }
    const base_freq_ix = note_ix % BASE_FREQS.length;
    const num_octaves_above = Math.floor(note_ix / BASE_FREQS.length);
    return BASE_FREQS[base_freq_ix] * (1 << num_octaves_above);
}

function perBeat(audio, synthSequence, drumSequence, beatIndex) {
    const notes = synthSequence[beatIndex];
    let freqs = notes.filter(n => n >= 0).map(n => noteFrequency(n));
    synthPlayVoices(audio.synths[0], freqs, audio.audioCtx);

    for (let voiceIx = 0; voiceIx < NUM_DRUM_VOICES; ++voiceIx) {
        const soundIx = drumSequence[beatIndex][voiceIx];
        if (soundIx < 0) {
            continue;
        }
        if (soundIx >= audio.drumSounds.length) {
            throw "ERROR: bad sound ix " + soundIx;
        }
        playSoundFromBuffer(audio.audioCtx, audio.drumSounds[soundIx]);
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

// Method of JamModel
function updateSequence(sequenceIx, beatIx, noteIx) {
    let sequence = [];
    if (sequenceIx === 0) {
        sequence = this.synthSequence;
    } else if (sequenceIx === 1) {
        sequence = this.drumSequence;
    } else {
        throw "unexpected sequence ix";
    }
    // Looking for if this note is already active. If so, deactivate it.
    let changed = false;
    let numVoices = sequence[0].length;
    for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
        if (sequence[beatIx][voiceIx] === noteIx) {
            sequence[beatIx][voiceIx] = -1;
            changed = true;
            break;
        }
        if (sequence[beatIx][voiceIx] === -1) {
            sequence[beatIx][voiceIx] = noteIx;
            changed = true;
            break;
        }
    }
    if (changed) {
        this.stateChange(this.playback.playIntervalId === null
            ? -1 : this.playback.beatIndex,
            this.synthSequence, this.drumSequence,
            this.playback.bpm);
        this.sendStateToServer();
    }
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
    this.updateSynthSequence = updateSequence.bind(this, 0);
    this.updateDrumSequence = updateSequence.bind(this, 1);

    for (let i = 0; i < NUM_BEATS; i++) {
        let initSynthNotes = [];        
        for (let j = 0; j < NUM_SYNTH_VOICES; ++j) {
            initSynthNotes.push(-1);
        }
        this.synthSequence.push(initSynthNotes);
        let initDrumNotes = [];
        for (let j = 0; j < NUM_DRUM_VOICES; ++j) {
            initDrumNotes.push(-1);
        }        
        this.drumSequence.push(initDrumNotes);
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
