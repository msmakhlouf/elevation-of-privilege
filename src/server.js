import { Server, FlatFile } from 'boardgame.io/server';
import ElevationOfPrivilege from './game/eop';
import Router from 'koa-router';
import Koa from 'koa';
import cors from '@koa/cors';
import koaBody from 'koa-body';
import { getTypeString } from './utils';
import { getDatabase } from './config';
import request from 'superagent';
import uuidv4 from 'uuid/v4';
import { SERVER_PORT, API_PORT, INTERNAL_API_PORT } from './constants';

const app = new Koa();
const router = new Router();

const server = Server({
  games: [ElevationOfPrivilege],
  db: getDatabase(),
});

router.get('/players/:id', async ctx => {
  const gameID = ctx.params.id;
  const r = await request
    .get(`http://localhost:${INTERNAL_API_PORT}/games/${ElevationOfPrivilege.name}/${gameID}`);
  ctx.body = r.body;
});

router.post('/create', koaBody(), async ctx => {
  const r = await request
    .post(`http://localhost:${INTERNAL_API_PORT}/games/${ElevationOfPrivilege.name}/create`)
    .send({
      numPlayers: ctx.request.body.players,
    });

  const gameName = ElevationOfPrivilege.name;
  const gameId = r.body.gameID;

  const credentials = [];

  for (var i=0; i<ctx.request.body.players; i++) {
    const j = await request
      .post(`http://localhost:${INTERNAL_API_PORT}/games/${ElevationOfPrivilege.name}/${gameId}/join`)
      .send({
        playerID: i,
        playerName: ctx.request.body.names[i],
      });
    
      credentials.push(j.body.playerCredentials);
  }

  if (typeof ctx.request.body.model !== 'undefined') {
    // save the model in the db, not in the setupData
    await server.db.set(`${gameName}:${gameId}:model`, ctx.request.body.model);
  }

  ctx.body = {
    game: gameId,
    credentials,
  };
});

router.get('/model/:id', async ctx => {
  const gameName = ElevationOfPrivilege.name;
  const gameID = ctx.params.id;
  const model = await server.db.get(`${gameName}:${gameID}:model`);
  ctx.body = model;
});

router.get('/download/:id', async ctx => {
  const gameName = ElevationOfPrivilege.name;
  const gameID = ctx.params.id;
  const res = await server.db.get(`${gameName}:${gameID}`);
  const metadata = await server.db.get(`${gameName}:${gameID}:metadata`);
  let model = await server.db.get(`${gameName}:${gameID}:model`);

  // update the model with the identified threats
  Object.keys(res.G.identifiedThreats).forEach(diagramIdx => {
    Object.keys(res.G.identifiedThreats[diagramIdx]).forEach(componentIdx => {
      let diagram = model.detail.diagrams[diagramIdx].diagramJson;
      let cell = null;
      for (let i=0; i<diagram.cells.length; i++) {
        let c = diagram.cells[i];
        if (c.id === componentIdx) {
          cell = c;
          break;
        }
      }
      if (cell !== null) {
        let threats = [];
        if (Array.isArray(cell.threats)) {
          threats = cell.threats;
        }
        Object.keys(res.G.identifiedThreats[diagramIdx][componentIdx]).forEach(threatIdx => {
          let t = res.G.identifiedThreats[diagramIdx][componentIdx][threatIdx];
          threats.push({
            status: "Open",
            severity: t.severity,
            id: t.id,
            methodology: "STRIDE",
            type: getTypeString(t.type),
            title: t.title,
            description: t.description,
            mitigation: t.mitigation,
            owner: metadata.players[t.owner].name,
            game: gameID,
          })
        });
      }
    });
  });

  ctx.attachment(model.summary.title + ".json");
  ctx.body = model;
});

server.run({
  port: SERVER_PORT,
  callback: () => {
    console.log(`Serving at: http://localhost:${SERVER_PORT}/`);
  },
  lobbyConfig: {
    apiPort: INTERNAL_API_PORT,
    uuid: uuidv4,
    apiCallback: () => {
      console.log(`Internal API serving at: http://localhost:${INTERNAL_API_PORT}/`);
    },
  }
});

app.use(cors());
app.use(router.routes()).use(router.allowedMethods());
app.listen(API_PORT, () => {
  console.log(`API serving at: http://localhost:${API_PORT}/`);
});