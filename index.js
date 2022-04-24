// import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useLoaders, usePhysics, useMeshLodder, useCleanup} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');
const glbUrls = [
  `${baseUrl}plants.glb`,
  `${baseUrl}rocks.glb`,
];

/* const _makeLodArray = () => {
  const lods = Array(3);
  for (let i = 0; i < 3; i++) {
    lods[i] = [];
  };
  return lods;
}; */

export default () => {
  const app = useApp();
  const physics = usePhysics();
  const MeshLodder = useMeshLodder();

  app.name = 'plants';

  const meshLodder = new MeshLodder();

  const lods = {};
  let physicsIds = [];
  (async () => {
    await Promise.all(glbUrls.map(async glbUrl => {
      const u = glbUrl;
      let o = await new Promise((accept, reject) => {
        const {gltfLoader} = useLoaders();
        gltfLoader.load(u, accept, function onprogress() {}, reject);
      });
      o = o.scene;
      o.updateMatrixWorld();

      o.traverse(o => {
        if (o.isMesh) {
          const match = o.name.match(/^(.+)_LOD([012])$/);
          if (match) {
            const name = match[1];
            const index = parseInt(match[2], 10);

            let ls = lods[name];
            if (!ls) {
              ls = Array(3).fill(null);
              lods[name] = ls;
            }
            ls[index] = o;
          }
        }
      });

      // app.add(o);
    }));

    // console.log('got lods', lods);
    for (const name in lods) {
      const ls = lods[name];
      meshLodder.registerLodMesh(name, ls);
    }
    meshLodder.compile();
  })();

  const chunksObject = meshLodder.getChunks();
  app.add(chunksObject);
  chunksObject.updateMatrixWorld();

  useFrame(() => {
    meshLodder.update();
  });
  
  useCleanup(() => {
    for (const physicsId of physicsIds) {
      physics.removeGeometry(physicsId);
    }
  });

  return app;
};
