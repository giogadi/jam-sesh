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
    this.changeBpm = function(newBpm) {};

    this.uiElements = {
        playButton: null,
        bpmLabel: null,
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

    this.uiElements.bpmLabel = element.appendChild(document.createElement('p'));
    this.uiElements.bpmLabel.innerHTML = "BPM: N/A";

    element.appendChild(document.createElement('br'));

    let canvas = document.createElement('canvas');
    canvas.setAttribute('id', 'interface');
    canvas.setAttribute('height', '600');
    this.uiElements.canvas = element.appendChild(canvas);

    this.viewModel = {
        synthSequence: [-1],
        drumSequence: [-1],
        currentBeatIndex: -1,
        bpm: 1,
    };

    this.updateView = function updateView(newViewModel) {
        this.viewModel.synthSequence = newViewModel.synthSequence.slice();
        this.viewModel.drumSequence = newViewModel.drumSequence.slice();
        this.viewModel.currentBeatIndex = newViewModel.currentBeatIndex;
        this.viewModel.bpm = newViewModel.bpm;
        this.uiElements.bpmLabel.innerHTML =
            "BPM: " + newViewModel.bpm;
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

    let changeBpmOnKey = function changeBpmOnKey(event) {
        const delta = 10;
        if (event.key === "ArrowDown") {
            this.changeBpm(this.viewModel.bpm - delta);
        } else if (event.key === "ArrowUp") {
            this.changeBpm(this.viewModel.bpm + delta);
        }
    }
    document.addEventListener('keydown', changeBpmOnKey.bind(this));
};
