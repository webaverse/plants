import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useFrame, useActivate, useLoaders, usePhysics, useMeshLodder, useCleanup, useWorld} = metaversefile;
// import * as metaverseModules from './metaverse-modules.js';

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');
const glbUrls = [
  `${baseUrl}plants.glb`,
  `${baseUrl}rocks.glb`,
];

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();

export default () => {
  const app = useApp();
  const world = useWorld();
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

  const _loadMeshLodApp = async ({
    position,
    quaternion,
    scale,
    meshLodderId,
    physicsId,
  }) => {
    const app = await world.appManager.addTrackedApp(
      `./metaverse_modules/mesh-lod-item/index.js`,
      position,
      quaternion,
      scale,
      [
        {
          key: 'meshLodderId',
          value: meshLodderId,
        },
        {
          key: 'physicsId',
          value: physicsId,
        },
        {
          key: 'wear',
          value: {
            "boneAttachment": "head",
            "position": [0, 0.3, 0],
            "quaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1],
            "grabAnimation": "pick_up",
          }
        },
        {
          key: 'use',
          value: {
            "animation": "pickUpThrow",
            "behavior": "throw",
            "boneAttachment": "head",
            "position": [0, 0.3, 0],
            "quaternion": [0, 0, 0, 1],
            "scale": [1, 1, 1],
          },
        },
      ],
    );
    return app;
  };

  const itemApps = [];

  useActivate(e => {
    const item = meshLodder.getItemByPhysicsId(e.physicsId);
    localMatrix.compose(item.position, item.quaternion, item.scale)
      .premultiply(app.matrixWorld)
      .decompose(localVector, localQuaternion, localVector2);
    const position = localVector;
    const quaternion = localQuaternion;
    const scale = localVector2;

    (async () => {
      const itemApp = await _loadMeshLodApp({
        position,
        quaternion,
        scale,
        meshLodderId: meshLodder.id,
        physicsId: e.physicsId,
      });
      itemApps.push(itemApp);

      meshLodder.deleteItem(item);
    })();
  });

  app.getPhysicsObjects = () => meshLodder.getPhysicsObjects();

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
