'use strict';

class SequencerTable extends React.Component {
  render() {
    let numColumns = 16;
    let columns = [];
    for (let i = 0; i < numColumns; ++i) {
      columns.push(i);
    }

    let numRows = 16;
    let rows = [];
    for (let i = 0; i < numRows; ++i) {
      rows.push(i);
    }
    return (
      <table>
        <tbody>
          { rows.map((r) =>
              <tr key={r.toString()}>
                { columns.map((c) =>
                  <td key={c.toString()}><input type="checkbox" /></td>)}
              </tr>)}
        </tbody>
      </table>
    );
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);
  }

  componentDidMount() {
    const initSoundAsync = async () => {
      this.sound = await initSound();
    };
    initSoundAsync();
  }

  render() {
    return <SequencerTable />
  }
}

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

  const domContainer = document.querySelector('#root');
  const root = ReactDOM.createRoot(domContainer);
  root.render(<App />);
}

main();