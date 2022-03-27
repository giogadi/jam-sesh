async function main() {
    // Let's wait for a mouse click before doing anything
    let msg = document.getElementById('message');
    msg.innerHTML = 'Click to start';
    const waitForClick = () =>
        new Promise((resolve) => {
            window.addEventListener('click', () => resolve(), {once: true});
        });
    await waitForClick();
    msg.innerHTML = '';

    let jamModel = new JamModel();
    let jamView = new JamView(document.body);

    // method of JamModel
    function stateChange() {
        let cellSequence = [];
        for (let i = 0; i < this.synthSequence.length; ++i) {
            let voices = [];
            let numVoices = this.synthSequence[0].length;
            for (let voiceIx = 0; voiceIx < numVoices; ++voiceIx) {
                if (this.synthSequence[i][voiceIx] < 0) {
                    voices.push(-1);
                } else {
                    voices.push(fromNoteIxToCellIx(this.currentScale, this.synthSequence[i][voiceIx]));
                }
            }
            cellSequence.push(voices);
        }

        let beatIndex = this.playback.playIntervalId === null ? -1 : this.playback.beatIndex;

        let viewModel = {
            synthSequence: cellSequence,
            drumSequence: this.drumSequence,
            currentBeatIndex: beatIndex,
            bpm: this.playback.bpm,
            scale: this.currentScale
        };
        jamView.updateView(viewModel);
    }

    jamView.onClickUpdateSynthSequence = jamModel.updateSynthSequence.bind(jamModel);
    jamView.onClickUpdateDrumSequence = jamModel.updateDrumSequence.bind(jamModel);
    jamView.changeBpm = changeBpm.bind(jamModel);
    jamView.changeScale = scaleChanged.bind(jamModel);
    jamView.changeFilterCutoff = filterCutoffChanged.bind(jamModel);
    jamView.togglePlayback = jamModel.togglePlayback.bind(jamModel);
    jamModel.stateChange = stateChange.bind(jamModel);

    jamModel.forceStateUpdate();
}

main();