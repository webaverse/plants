// import * as THREE from 'three';
// import easing from './easing.js';
import metaversefile from 'metaversefile';
const {useApp, useLoaders, usePhysics, useCleanup} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

export default () => {
  const app = useApp();
  const physics = usePhysics();

  app.name = 'plants';

  let physicsIds = [];
  (async () => {
    const u = `${baseUrl}plants.glb`;
    let o = await new Promise((accept, reject) => {
      const {gltfLoader} = useLoaders();
      gltfLoader.load(u, accept, function onprogress() {}, reject);
    });
    o = o.scene;

    const lods = Array(3);
    for (let i = 0; i < 3; i++) {
      lods[i] = [];
    }
    o.traverse(o => {
      if (o.isMesh) {
        const match = o.name.match(/LOD([012])/);
        if (match) {
          const index = parseInt(match[1], 10);
          lods[index].push(o);
        }
      }
    });

    console.log('got plants', lods);

    app.add(o);
    o.updateMatrixWorld();
  })();
  
  useCleanup(() => {
    for (const physicsId of physicsIds) {
      physics.removeGeometry(physicsId);
    }
  });

  return app;
};
