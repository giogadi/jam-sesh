let jamModel = new JamModel();
let jamView = new JamView(document.body);
jamView.onClickUpdateSynthSequence = jamModel.updateSynthSequence.bind(jamModel);
jamView.onClickUpdateDrumSequence = jamModel.updateDrumSequence.bind(jamModel);
jamView.changeBpm = changeBpm.bind(jamModel);
jamView.togglePlayback = jamModel.togglePlayback.bind(jamModel);
jamModel.stateChange = function(beatIndex, synthSequence, drumSequence, bpm, scale) {
    let cellSequence = [];
    for (let i = 0; i < synthSequence.length; ++i) {
        let voices = [];
        let numVoices = synthSequence[0].length;
        for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
            if (synthSequence[i][voiceIx] < 0) {
                voices.push(-1);
            } else {
                voices.push(fromNoteIxToCellIx(scale, synthSequence[i][voiceIx]));
            }
        }
        cellSequence.push(voices);
    }

    let viewModel = {
        synthSequence: cellSequence,
        drumSequence: drumSequence,
        currentBeatIndex: beatIndex,
        bpm: bpm
    };
    jamView.updateView(viewModel);
};
jamModel.forceStateUpdate();
