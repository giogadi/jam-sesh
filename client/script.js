function getGearDimensions(canvasRect, numBeats, numNotes, numDrums) {
    const w = canvasRect.width;
    const h = canvasRect.height;
    const startX = 0;
    const startY = 0;
    const spacing = 50;

    // Want startX + beatSize * numBeats <= w &&
    // startY + numNotes*beatSize + spacing + numDrums*beatSize <= h.
    const beatSizeFromWidth = Math.floor((w - startX) / numBeats);
    const beatSizeFromHeight = Math.floor(
        (h - startY - spacing) / (numNotes + numDrums));
    const beatSize = Math.min(beatSizeFromWidth, beatSizeFromHeight);
    return {
        synthBeatSize: beatSize,
        synthStartX: startX,
        synthStartY: startY,
        spacing: spacing,
        drumBeatSize: beatSize,
        drumStartX: startX,
        drumStartY: startY + numNotes * beatSize + spacing,
    };
}

function drawSequence(
    context2d, startX, startY, numNotes, sequence, beatSize, currentBeatIndex,
    noteIndexToCellIndexFn) {
    const numBeats = sequence.length;
    // Draw our beatboxes, where inactive beats are grey and active
    // beats are red.
    //
    // First draw the gray inactive beats as one big rectangle.
    context2d.fillStyle = 'rgb(100, 100, 100)';
    context2d.fillRect(startX, startY,
                       beatSize * numBeats, beatSize * numNotes);
    // Now draw the active beats on the appropriate note row.
    context2d.fillStyle = 'rgb(200, 0, 0)';
    for (let beatIx = 0; beatIx < numBeats; beatIx++) {
        if (sequence[beatIx] < 0) {
            continue;
        }
        const noteIx = sequence[beatIx];
        const cellIx = noteIndexToCellIndexFn(noteIx);
        const cellRow = (numNotes - 1) - cellIx;
        context2d.fillRect(
            startX + beatIx * beatSize,
            startY + cellRow * beatSize,
            beatSize, beatSize);
    }
    // If playback is on, we highlight the current beat in green.
    if (currentBeatIndex >= 0) {
        // TODO: assert that currentBeatIndex is a valid index
        context2d.fillStyle = 'rgba(0, 255, 0, 0.5)';
        context2d.fillRect(
            startX + currentBeatIndex * beatSize,
            startY,
            beatSize, numNotes * beatSize);
    }
    // Finally, draw a grid to divide up the beats and notes.
    context2d.strokeStyle = 'rgb(0, 0, 0)';
    for (let lineIx = 0; lineIx <= numBeats; lineIx++) {
        context2d.beginPath();
        const x = startX + lineIx * beatSize;
        context2d.moveTo(x, startY);
        context2d.lineTo(x, startY + numNotes * beatSize);
        context2d.stroke();
    }
    for (let lineIx = 0; lineIx <= numNotes; lineIx++) {
        context2d.beginPath();
        const y = startY + lineIx * beatSize;
        context2d.moveTo(startX, y);
        context2d.lineTo(startX + numBeats * beatSize, y);
        context2d.stroke();
    }
}

// TODO: All these cell-note conversions should probably be part of
// the View's state (so that we can have scrollbars and shit)
const SYNTH_NOTE_OFFSET = 24;
function synthCellIndexToNoteIndex(cellIndex) {
    return cellIndex + SYNTH_NOTE_OFFSET;
}
function synthNoteIndexToCellIndex(noteIndex) {
    return noteIndex - SYNTH_NOTE_OFFSET;
}

function drumCellIndexToNoteIndex(cellIndex) {
    return cellIndex;
}
function drumNoteIndexToCellIndex(noteIndex) {
    return noteIndex;
}

// With bottom-left cell index of (0,0) and (x=0,y=0) equal to top-left corner.
// Returns null if (x,y) does not lie on grid.
function getClickedCellIx(x, y, numRows, numCols, cellSize) {
    const colIx = Math.floor(x / cellSize);
    if (colIx >= numCols) {
        // Clicked too far to the right
        return null;
    }
    const rowIx = (numRows - 1) - Math.floor(y / cellSize);
    if (rowIx < 0) {
        // Clicked too far down
        return null;
    }
    if (rowIx >= numRows) {
        // Clicked too far up
        return null;
    }
    return {
        row: rowIx,
        col: colIx,
    }
}

function onSequencerClick(x, y, beatSize, numBeats, numNotes,
                          sequence,
                          cellToNoteFn,
                          updateSequenceFn) {
    if (x < 0) {
        // Too far left
        return;
    }
    if (y < 0) {
        // Too far up
        return;
    }
    const cell = getClickedCellIx(x, y, numNotes, numBeats, beatSize);
    console.log(x + " " + y + " " + JSON.stringify(cell));
    if (cell === null) {
        return;
    }
    const beatIx = cell.col;
    const noteIx = cellToNoteFn(cell.row);
    if (sequence[beatIx] === noteIx) {
        updateSequenceFn(beatIx, -1);
    } else {
        updateSequenceFn(beatIx, noteIx);
    }
}

function onCanvasClick(event, canvas, numNotes, numDrums,
                       synthSequence, drumSequence,
                       updateSynthSequenceFn,
                       updateDrumSequenceFn) {
    const canvasRect = canvas.getBoundingClientRect();
    const gearDims = getGearDimensions(
        canvasRect, synthSequence.length, numNotes, numDrums);
    const x = (event.clientX - canvas.offsetLeft);
    const y = (event.clientY - canvas.offsetTop);
    onSequencerClick(x - gearDims.synthStartX, y - gearDims.synthStartY,
                     gearDims.synthBeatSize,
                     synthSequence.length, numNotes, synthSequence,
                     synthCellIndexToNoteIndex,
                     updateSynthSequenceFn);
    onSequencerClick(x - gearDims.drumStartX, y - gearDims.drumStartY,
                     gearDims.drumBeatSize,
                     drumSequence.numBeats, numDrums, drumSequence,
                     drumCellIndexToNoteIndex,
                     updateDrumSequenceFn);
}

// Method of JamView
function drawInterface() {
    const canvasRect = this.uiElements.canvas.getBoundingClientRect();
    // Clear the canvas
    let ctx = this.uiElements.canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasRect.width, canvasRect.height);
    ctx.fillStyle = 'rgb(200, 200, 200)';
    ctx.fillRect(0, 0, canvasRect.width, canvasRect.height);

    // TODO: we assume synth and drum sequence have same length here
    const gearDims =
          getGearDimensions(canvasRect, this.viewModel.synthSequence.length,
                            this.numNotes, this.numDrums);

    // Synth sequencer
    drawSequence(ctx, gearDims.synthStartX, gearDims.synthStartY, this.numNotes,
                 this.viewModel.synthSequence, gearDims.synthBeatSize,
                 this.viewModel.currentBeatIndex,
                 synthNoteIndexToCellIndex);

    // Drum sequencer
    drawSequence(ctx, gearDims.drumStartX, gearDims.drumStartY,
                 this.numDrums,
                 this.viewModel.drumSequence, gearDims.drumBeatSize,
                 this.viewModel.currentBeatIndex,
                 drumNoteIndexToCellIndex);
}

// NOTE TO SELF: this is a "named function expression".
//
// But why the fuck don't we just declare the function "normally"?
let JamView = function JamView(element) {
    this.onClickUpdateSynthSequence = s => {};
    this.onClickUpdateDrumSequence = s => {};
    this.togglePlayback = function() {};

    this.uiElements = {
        playButton: null,
        canvas: null,
    };

    let playButton = document.createElement('button');
    playButton.setAttribute('type', 'button');
    playButton.innerHTML = "Play/Stop";
    this.uiElements.playButton = element.appendChild(playButton);
    let play = function play() {
        this.togglePlayback();
    };
    this.uiElements.playButton.onclick = play.bind(this);

    element.appendChild(document.createElement('br'));

    let canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'interface');
    canvas.setAttribute('height', '600');
    this.uiElements.canvas = element.appendChild(canvas);

    this.viewModel = {
        synthSequence: [-1],
        drumSequence: [-1],
        currentBeatIndex: -1,
    };

    this.updateView = function updateView(newViewModel) {
        this.viewModel.synthSequence = newViewModel.synthSequence.slice();
        this.viewModel.drumSequence = newViewModel.drumSequence.slice();
        this.viewModel.currentBeatIndex = newViewModel.currentBeatIndex;
    }

    this.numNotes = 13;
    this.numDrums = 2;

    let onClick = function onClick(event) {
        onCanvasClick(event, this.uiElements.canvas, this.numNotes, this.numDrums,
                      this.viewModel.synthSequence,
                      this.viewModel.drumSequence,
                      this.onClickUpdateSynthSequence,
                      this.onClickUpdateDrumSequence);
    }
    this.uiElements.canvas.onclick = onClick.bind(this);

    let draw = function draw() {
        drawInterface.bind(this)();
        window.requestAnimationFrame(draw.bind(this));
    }
    window.requestAnimationFrame(draw.bind(this));
};

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
function togglePlayPause() {
    // If we are still waiting for audio to load, don't start
    // playback.
    if (this.audio === null) {
        return;
    }
    if (this.playback.playIntervalId !== null) {
        window.clearInterval(this.playback.playIntervalId);
        this.playback.playIntervalId = null;
        this.playback.beatIndex = 0;
        this.stateChange(-1, this.synthSequence, this.drumSequence);
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
                     this.synthSequence, this.drumSequence);
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
                         this.drumSequence);
        perBeat(this.audio, this.synthSequence, this.drumSequence,
                this.playback.beatIndex);
    };
    this.playback.playIntervalId =
        window.setInterval(beatFn.bind(this), /*delay=*/ticksPerBeat);
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
                     this.drumSequence);
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
    this.stateChange = function(beatIndex, synthSequence, drumSequence) { };
    this.togglePlayback = togglePlayPause.bind(this);
    this.sendStateToServer = function () { };
    this.updateSynthSequence = function updateSynthSequence(beatIx, noteIx) {
        this.synthSequence[beatIx] = noteIx;
        this.stateChange(this.playback.playIntervalId === null
                         ? -1 : this.playback.beatIndex,
                         this.synthSequence, this.drumSequence);
        this.sendStateToServer();
    }
    this.updateDrumSequence = function updateDrumSequence(beatIx, noteIx) {
        this.drumSequence[beatIx] = noteIx;
        this.stateChange(this.playback.playIntervalId === null
                         ? -1 : this.playback.beatIndex,
                         this.synthSequence, this.drumSequence);
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
                         this.synthSequence, this.drumSequence);
    };

    openSocket().then(onSocketOpen.bind(this),
                      e => console.log("socket connection failed: " + e));
}

let jamModel = new JamModel();
let jamView = new JamView(document.body);
jamView.onClickUpdateSynthSequence = jamModel.updateSynthSequence.bind(jamModel);
jamView.onClickUpdateDrumSequence = jamModel.updateDrumSequence.bind(jamModel);
jamView.togglePlayback = jamModel.togglePlayback.bind(jamModel);
jamModel.stateChange = function(beatIndex, synthSequence, drumSequence) {
    let viewModel = {
        synthSequence: synthSequence,
        drumSequence: drumSequence,
        currentBeatIndex: beatIndex,
    };
    jamView.updateView(viewModel);
};
jamModel.forceStateUpdate();
