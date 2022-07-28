import * as THREE from 'three';
import metaversefile from 'metaversefile';
import { _toEscapedUtf8String } from 'ethers/lib/utils';
import { Vector3 } from 'three';
const {useApp, usePhysics, useLocalPlayer, useFrame, useActivate, useLoaders, useMeshLodder, useInstancing, useAtlasing, useCleanup, useWorld, useLodder, useProcGenManager, useDefaultModules} = metaversefile;

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
const localBox = new THREE.Box3();

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

//#region ASSETS TO BE IMPORTED
const glbSpecs = [
  {
    type: 'plants',
    url: `${baseUrl}plants.glb`,
  },
  {
    type: 'rock',
    url: `${baseUrl}rocks.glb`,
  }, 
  {
    type: 'trees',
    url: `${baseUrl}trees.glb`,
  },
];
//#endregion

//#region CHUNK SETUP
const chunkWorldSize = 16;
const maxInstancesPerDrawCall = 128;
const maxDrawCallsPerGeometry = 32;
const maxAnisotropy = 16;
//#endregion

// TAKE ONLY 2 FNS FROM USE INSTANCING
const {InstancedBatchedMesh, InstancedGeometryAllocator} = useInstancing();
const {createTextureAtlas} = useAtlasing();


class VegetationMesh extends InstancedBatchedMesh {
  constructor({
    procGenInstance,
    vegetationAppDataArray =[],
    lodMeshes = [],
    shapeAddresses = [],
    physicsGeometries = [],
    physics = null,
  } = {}) {
    // instancing


    const {
      atlasTextures,
      geometries: lod0Geometries,
    } = createTextureAtlas(vegetationAppDataArray.map(vegetationApp => vegetationApp.lods[0]),{
      textures: ['map', 'normalMap'],
      attributes: ['position', 'normal', 'uv'],
    })


    const allocator = new InstancedGeometryAllocator(lod0Geometries, [
      {
        name: 'p',
        Type: Float32Array,
        itemSize: 3,
      },
      {
        name: 'q',
        Type: Float32Array,
        itemSize: 4,
      },
    ], {
      maxInstancesPerDrawCall,
      maxDrawCallsPerGeometry,
      boundingType: 'box',
    });
    const {geometry, textures: attributeTextures} = allocator;
    for (const k in attributeTextures) {
      const texture = attributeTextures[k];
      texture.anisotropy = maxAnisotropy;
    }

    // material

    const material = new THREE.MeshStandardMaterial({
      map: atlasTextures.map,
      normalMap: atlasTextures.normalMap,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.5,
      onBeforeCompile: (shader) => {
        // console.log('on before compile', shader.fragmentShader);

        shader.uniforms.pTexture = {
          value: attributeTextures.p,
          needsUpdate: true,
        };
        shader.uniforms.qTexture = {
          value: attributeTextures.q,
          needsUpdate: true,
        };
        
        // vertex shader

        shader.vertexShader = shader.vertexShader.replace(`#include <uv_pars_vertex>`, `\
#undef USE_INSTANCING

#include <uv_pars_vertex>

uniform sampler2D pTexture;
uniform sampler2D qTexture;

vec3 rotate_vertex_position(vec3 position, vec4 q) { 
  return position + 2.0 * cross(q.xyz, cross(q.xyz, position) + q.w * position);
}
        `);
        shader.vertexShader = shader.vertexShader.replace(`#include <begin_vertex>`, `\
#include <begin_vertex>

int instanceIndex = gl_DrawID * ${maxInstancesPerDrawCall} + gl_InstanceID;
const float width = ${attributeTextures.p.image.width.toFixed(8)};
const float height = ${attributeTextures.p.image.height.toFixed(8)};
float x = mod(float(instanceIndex), width);
float y = floor(float(instanceIndex) / width);
vec2 pUv = (vec2(x, y) + 0.5) / vec2(width, height);
vec3 p = texture2D(pTexture, pUv).xyz;
vec4 q = texture2D(qTexture, pUv).xyzw;

// instance offset
{
  transformed = rotate_vertex_position(transformed, q);
  transformed += p;
}
/* {
  transformed.y += float(gl_DrawID) * 10.;
  transformed.x += float(gl_InstanceID) * 10.;
} */
        `);
        shader.fragmentShader = shader.fragmentShader.replace(`#include <uv_pars_fragment>`, `\
#undef USE_INSTANCING

#if ( defined( USE_UV ) && ! defined( UVS_VERTEX_ONLY ) )
	varying vec2 vUv;
#endif
        `);

        // fragment shader
        
        return shader;
      },
    });

    // mesh

    super(geometry, material, allocator);
    this.frustumCulled = false;
    
    this.procGenInstance = procGenInstance;
    //this.meshes = lodMeshes;
    this.vegetationAppsData = vegetationAppDataArray;
    //this.shapeAddresses = shapeAddresses;
    //this.physicsGeometries = physicsGeometries;
    this.physics = physics;
    this.physicsObjects = [];

    this.instanceObjects = new Map();
  }

  drawChunk(chunk, renderData, tracker){
    const {
      vegetationData,
    } = renderData;
    const localPhysicsObjects = [];
    const _renderVegetationGeometry = (drawCall, ps, qs, index) => {
      // geometry
      //console.log(ps)
      const pTexture = drawCall.getTexture('p');
      const pOffset = drawCall.getTextureOffset('p');
      const qTexture = drawCall.getTexture('q');
      const qOffset = drawCall.getTextureOffset('q');

      

      const px = ps[index * 3];
      const py = ps[index * 3 + 1];
      const pz = ps[index * 3 + 2];
      pTexture.image.data[pOffset] = px;
      pTexture.image.data[pOffset + 1] = py;
      pTexture.image.data[pOffset + 2] = pz;

      const qx = qs[index * 4];
      const qy = qs[index * 4 + 1];
      const qz = qs[index * 4 + 2];
      const qw = qs[index * 4 + 3];
      qTexture.image.data[qOffset] = qx;
      qTexture.image.data[qOffset + 1] = qy;
      qTexture.image.data[qOffset + 2] = qz;
      qTexture.image.data[qOffset + 3] = qw;

      drawCall.updateTexture('p', pOffset, ps.length);
      drawCall.updateTexture('q', qOffset, qs.length);

      // physics
      const shapeAddress = this.#getShapeAddress(drawCall.geometryIndex);
      const physicsObject = this.#addPhysicsShape(shapeAddress, drawCall.geometryIndex, px, py, pz, qx, qy, qz, qw);
      this.physicsObjects.push(physicsObject);
      localPhysicsObjects.push(physicsObject);

      drawCall.incrementInstanceCount();
      const appData = this.vegetationAppsData[drawCall.geometryIndex];
      this.instanceObjects.set(physicsObject.physicsId, {drawCall, appData});
    };

      
    const drawcalls = [];
    for (let i = 0; i < vegetationData.instances.length; i++) {
      const geometryNoise = vegetationData.instances[i];
      const geometryIndex = Math.floor(geometryNoise * this.vegetationAppsData.length);
      
      localBox.setFromCenterAndSize(
        localVector.set(
          (chunk.min.x + 0.5) * chunkWorldSize,
          (chunk.min.y + 0.5) * chunkWorldSize,
          (chunk.min.z + 0.5) * chunkWorldSize
        ),
        localVector2.set(chunkWorldSize, chunkWorldSize * 256, chunkWorldSize)
      );

      let drawCall = this.allocator.allocDrawCall(geometryIndex, localBox);
      drawcalls.push(drawCall);
      _renderVegetationGeometry(drawCall, vegetationData.ps, vegetationData.qs, i);
    }

    
    const onchunkremove = () => {
      drawcalls.forEach(drawcall => {
        this.allocator.freeDrawCall(drawcall);
      });
      tracker.offChunkRemove(chunk, onchunkremove);

      const firstLocalPhysicsObject = localPhysicsObjects[0];
      const firstLocalPhysicsObjectIndex = this.physicsObjects.indexOf(firstLocalPhysicsObject);
      this.physicsObjects.splice(firstLocalPhysicsObjectIndex, localPhysicsObjects.length);
    };
    tracker.onChunkRemove(chunk, onchunkremove);

  }
  
  #getShapeAddress(geometryIndex) {
    return this.vegetationAppsData[geometryIndex].shapeAddress;
    //return this.shapeAddresses[geometryIndex];
  }
  #getShapeGeometry(geometryIndex){
    return  this.vegetationAppsData[geometryIndex].physicsGeometry;
    //return this.physicsGeometries[geometryIndex];
  }
  #addPhysicsShape(shapeAddress, geometryIndex, px, py, pz, qx, qy, qz, qw) {    
    localVector.set(px, py, pz);
    localQuaternion.set(qx, qy, qz, qw);
    localVector2.set(1, 1, 1);
    localMatrix.compose(localVector, localQuaternion, localVector2)
      .premultiply(this.matrixWorld)
      .decompose(localVector, localQuaternion, localVector2);

    // const matrixWorld = _getMatrixWorld(this.mesh, contentMesh, localMatrix, positionX, positionZ, rotationY);
    // matrixWorld.decompose(localVector, localQuaternion, localVector2);
    const position = localVector;
    const quaternion = localQuaternion;
    const scale = localVector2;
    const dynamic = false;
    const external = true;

    const physicsGeometry = this.#getShapeGeometry(geometryIndex);
    const physicsObject = this.physics.addConvexShape(shapeAddress, position, quaternion, scale, dynamic, external,physicsGeometry);
  
    this.physicsObjects.push(physicsObject);

    return physicsObject;
  }
  
  grabInstance(physicsId){
    const phys = metaversefile.getPhysicsObjectByPhysicsId(physicsId);
    this.physics.removeGeometry(phys);
    const {drawCall, appData} = this.instanceObjects.get(physicsId);
    drawCall.decrementInstanceCount();
    console.log(appData.type)
    //appData.doSomething or get some info
  }
  getPhysicsObjects() {
    return this.physicsObjects;
  }
}


class VegetationChunkGenerator {
  constructor(parent, {
    procGenInstance = null,
    vegetationAppDataArray = [],
    lodMeshes = [],
    shapeAddresses = [],
    physicsGeometries = [],
    physics = null,
  } = {}) {
    // parameters
    this.parent = parent;

    this.physicsMeshes = [];

    this.mesh = new VegetationMesh({
      procGenInstance,
      vegetationAppDataArray,
      lodMeshes,
      shapeAddresses,
      physicsGeometries,
      physics,
    });
    this
  }
  getChunks() {
    return this.mesh;
  }
  getPhysicsObjects() {
    return this.mesh.getPhysicsObjects();
  }
  disposeChunk(chunk) {
    const {abortController} = chunk.binding;
    abortController.abort();
    chunk.binding = null;
  }




  destroy() {
    // nothing; the owning lod tracker disposes of our contents
  }
}

class VegetationAppData{
  constructor( name, lods, type, physics)
  {
    this.name = name;
    this.lods = lods;
    this.type = type;
    this.shapeAddress = this.getShapeAdress(physics);
    this.physicsGeometry = this.getPhysicsGeometry(physics);
  }
  getShapeAdress(physics){
    const lastMesh = this.lods.findLast(lod => lod !== null);
    const buffer = physics.cookConvexGeometry(lastMesh);
    const shapeAddress = physics.createConvexShape(buffer);
    return shapeAddress;
  }
  getPhysicsGeometry(physics){
    const physicsObject = physics.addConvexShape(this.shapeAddress, new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(1,1,1), false, true);
    const geometry = physicsObject.physicsMesh.geometry;
    physics.removeGeometry(physicsObject);
    return geometry;
  }
}

export default e => {
  const app = useApp();
  const physics = usePhysics();
  const procGenManager = useProcGenManager();
  const world = useWorld();
  const meshLodManager = useMeshLodder();
  const lodItem = useDefaultModules().modules.meshLodItem;

  console.log(lodItem)

  app.name = 'vegetation';

  const meshLodder = meshLodManager.createMeshLodder();

  const seed = app.getComponent('seed') ?? null;
  let range = app.getComponent('range') ?? null;
  const wait = app.getComponent('wait') ?? false;

  if (range) {
    range = new THREE.Box3(
      new THREE.Vector3(range[0][0], range[0][1], range[0][2]),
      new THREE.Vector3(range[1][0], range[1][1], range[1][2])
    );
  }

  

  let generator = null;
  let tracker = null;
  const specs = {};
  e.waitUntil((async () => {
    await Promise.all(glbSpecs.map(async glbSpec => {
      const {type, url} = glbSpec;
      const u = url;
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

          let spec = specs[name];
          if (!spec) {
            spec = {
              type,
              lods: Array(3).fill(null),
            };
            specs[name] = spec;
          }
          spec.lods[index] = o;
        }
      }
    }));


    const lodMeshes = [];

    for (const name in specs) {
      const spec = specs[name];
      lodMeshes.push(spec.lods);
    }
    // physics

    const shapeAddresses = lodMeshes.map(lods => {
      const lastMesh = lods.findLast(lod => lod !== null);
      const buffer = physics.cookConvexGeometry(lastMesh);
      const shapeAddress = physics.createConvexShape(buffer);
      return shapeAddress;
    });

    //new
    const physicsGeometries = shapeAddresses.map(shapeAddress =>{
      const physicsObject = physics.addConvexShape(shapeAddress, new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(1,1,1), false, true);
      const geom = physicsObject.physicsMesh.geometry;
      physics.removeGeometry(physicsObject);
      return geom;
    })

    const vegetationAppDataArray = [];
    for (const name in specs) {
      const spec = specs[name];
      vegetationAppDataArray.push (new VegetationAppData(name, spec.lods, spec.type, physics))
    }

    // console.log(vegetationAppDatas);

    //shape adress
    //physics geometry
    //app name
    // ideally:
    // generator = new VegetationChunkGenerator(this, {
    //   procGenInstance,
    //   vegetationAppDataArray
    //   physics
    // });

    // generator
    const procGenInstance = procGenManager.getInstance(seed, range);

    generator = new VegetationChunkGenerator(this, {
      procGenInstance,
      vegetationAppDataArray,
      lodMeshes,
      shapeAddresses,
      physicsGeometries,
      physics
    });

    
    const numLods = 1;
    tracker = procGenInstance.getChunkTracker({
      //minLodRange:numLods
    });
    const chunkdatarequest = (e) => {
        const {chunk, waitUntil, signal} = e;
        const {lod} = chunk;
        //if (chunk.min.y === 0){
          const loadPromise = (async () => {
            const _getVegetationData = async () => {
              const result = await procGenInstance.dcWorkerManager.createVegetationSplat(
                chunk.min.x * chunkWorldSize,
                chunk.min.z * chunkWorldSize,
                lod
              );
              return result;
            };
            const [
              vegetationData
            ] = await Promise.all([
              _getVegetationData()
            ]);
            /* const renderData = await generator.waterMesh.getChunkRenderData(
              chunk,
              signal
            ); */
            signal.throwIfAborted();
      
            return {
              vegetationData
            };
          })();
          waitUntil(loadPromise);
        //}

    };
    const chunkAdd = e =>{
      const {renderData,chunk} = e;
      if (chunk.min.y === 0)
        generator.mesh.drawChunk(chunk, renderData, tracker);
    }
    tracker.onChunkDataRequest(chunkdatarequest);
    tracker.onChunkAdd(chunkAdd);
    


    const chunksMesh = generator.getChunks();
    app.add(chunksMesh);
    chunksMesh.updateMatrixWorld();

    // const coordupdate = e => {
    //   const {coord} = e.data;
    //   chunksMesh.updateCoord(coord);
    // };
    // tracker.addEventListener('coordupdate', coordupdate);



    if (wait) {
      await new Promise((accept, reject) => {
        tracker.addEventListener('update', () => {
          accept();
        }, {
          once: true,
        });
      });
    }
  })());

  useFrame(({timestamp, timeDiff}) => {
    if (!range && tracker) {
      const localPlayer = useLocalPlayer();
      localMatrix
        .copy(localPlayer.matrixWorld)
        .premultiply(localMatrix2.copy(app.matrixWorld).invert())
        .decompose(localVector, localQuaternion, localVector2);

      tracker.update(localVector);
      //heightfieldMapper.update(localVector);
      //tracker.update(localPlayer.position);
    }
  });

  const test = () => {console.log("test")}
  const _loadMeshLodApp = async ({
    physicsId,
    position,
    quaternion,
    scale,
  }) => {
    const app = await world.appManager.addTrackedApp(
      `./metaverse_modules/mesh-lod-item/index.js`,
      position,
      quaternion,
      scale,
      [
        {
          key: 'physicsId',
          value: physicsId,
        },
        {
          key: 'wear',
          value: {
            "boneAttachment": ["leftHand", "rightHand"],
            "position": [0, 0.1, 0],
            "quaternion": "upVectorHipsToPosition",
            "scale": [1, 1, 1],
            "grabAnimation": "pick_up",
            "holdAnimation": "pick_up_idle",
          }
        },
        {
          key: 'use',
          value: {
            "animation": "pickUpThrow",
            "behavior": "throw",
            "boneAttachment": ["leftHand", "rightHand"],
            "position": [0, 0.1, 0],
            "quaternion": "upVectorHipsToPosition",
            "scale": [1, 1, 1],
          },
        },
      ],
    );
    app.wear();
    return app;
  };


  useActivate((e)=>{
    generator.mesh.grabInstance(e.physicsId);
    //test();
    _loadMeshLodApp(e.physicsId);

  })
  useCleanup(()=>{
    tracker.destroy();
  })
  

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  return app;
};
