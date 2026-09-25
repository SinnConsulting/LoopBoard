/* Getting started: a repo without a tracker → Initialize scaffolds .loopboard/ → first story. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../server');

const template = (f) => fs.readFileSync(path.join(ROOT, 'media', f), 'utf8');

module.exports = {
  workspace: () => ({ files: {} }), // no .loopboard/ yet
  layout: { sidebar: false, panel: false, feature: 'Getting started' },
  async run(rec, ctx) {
    const { host, board } = ctx;
    // `loopboard.init` / the empty-state button: scaffold TODO.md + LOOP.md + tasks/ from the
    // shipped templates, then VS Code's info notification.
    host.on('createFiles', async () => {
      host.write('TODO.md', template('template-todo.md'));
      host.write('LOOP.md', template('template-loop.md'));
      await host.refresh();
      return true;
    });

    await rec.placeCursor(760, 460);
    await rec.caption('1', 'Open any repo — LoopBoard offers to set it up');
    await rec.hold(1400);
    await rec.caption('2', '<b>Initialize</b> scaffolds <b>.loopboard/</b>: TODO.md, LOOP.md, tasks/');
    await rec.click(board.locator('button:text-is("Initialize LoopBoard workspace")'));
    for (let i = 1; i <= 5; i++) {
      await rec.stage((a) => window.stage.notify('LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).', a), i / 5);
      await rec.snap(40);
    }
    await rec.hold(1600);

    await rec.caption('3', 'Write your first story — the loops take it from there');
    await rec.click(board.locator('.tb-new'), { ms: 600 });
    for (let i = 4; i >= 0; i--) {
      await rec.stage((a) => window.stage.notify('LoopBoard: initialized .loopboard/ (TODO.md, LOOP.md, tasks/).', a), i / 5);
      await rec.snap(40);
    }
    await rec.type('Add a /health endpoint that checks the database and Redis connections.', { per: 40, chunk: 2 });
    await rec.hold(1800);
    await rec.hideCaption();
    await rec.moveTo(760, 460, 400);
    await rec.loopBack();
  },
};
