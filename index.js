// import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useActivate, useLoaders, usePhysics, useMeshLodder, useCleanup} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');
const glbUrls = [
  `${baseUrl}plants.glb`,
  `${baseUrl}rocks.glb`,
];

export default () => {
  const app = useApp();
  const physics = usePhysics();
  const meshLodManager = useMeshLodder();

  app.name = 'plants';

  const meshLodder = meshLodManager.createMeshLodder();

  const lods = {};
  (async () => {
    await Promise.all(glbUrls.map(async glbUrl => {
      const u = glbUrl;
      let o = await new Promise((accept, reject) => {
        const {gltfLoader} = useLoaders();
        gltfLoader.load(u, accept, function onprogress() {}, reject);
      });
      o = o.scene;
      o.updateMatrixWorld();

      const meshes = [];
      o.traverse(o => {
        if (o.isMesh) {
          meshes.push(o);
        }
      });
      for (const o of meshes) {
        const match = o.name.match(/^(.+)_LOD([012])$/);
        if (match) {
          const name = match[1];
          const index = parseInt(match[2], 10);

          o.geometry.applyMatrix4(o.matrixWorld);
          o.parent.remove(o);

          o.position.set(0, 0, 0);
          o.quaternion.identity();
          o.scale.set(1, 1, 1);
          o.matrix.identity();
          o.matrixWorld.identity();

          let ls = lods[name];
          if (!ls) {
            ls = Array(3).fill(null);
            lods[name] = ls;
          }
          ls[index] = o;
        }
      }
    }));

    for (const name in lods) {
      const ls = lods[name];
      meshLodder.registerLodMesh(name, ls);
    }
    meshLodder.compile();
  })();

  const chunksObject = meshLodder.getChunks();
  app.add(chunksObject);
  chunksObject.updateMatrixWorld();

  app.getPhysicsObjects = () => meshLodder.getPhysicsObjects();

  useActivate(e => {
    const item = meshLodder.getItemByPhysicsId(e.physicsId);
    const itemMesh = item.cloneApp();
    meshLodder.deleteItem(item);
  });

  useFrame(() => {
    meshLodder.update();
  });
  
  useCleanup(() => {
    const physicsIds = meshLodder.getPhysicsObjects();
    for (const physicsId of physicsIds) {
      physics.removeGeometry(physicsId);
    }
  });

  return app;
};
