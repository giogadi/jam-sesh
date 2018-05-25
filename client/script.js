let jamModel = new JamModel();
let jamView = new JamView(document.body);
jamView.onClickUpdateSynthSequence = jamModel.updateSynthSequence.bind(jamModel);
jamView.onClickUpdateDrumSequence = jamModel.updateDrumSequence.bind(jamModel);
jamView.changeBpm = changeBpm.bind(jamModel);
jamView.togglePlayback = jamModel.togglePlayback.bind(jamModel);
jamModel.stateChange = function(beatIndex, synthSequence, drumSequence, bpm) {
    let viewModel = {
        synthSequence: synthSequence,
        drumSequence: drumSequence,
        currentBeatIndex: beatIndex,
        bpm: bpm
    };
    jamView.updateView(viewModel);
};
jamModel.forceStateUpdate();
