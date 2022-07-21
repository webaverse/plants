import * as THREE from 'three';
import metaversefile from 'metaversefile';
import { _toEscapedUtf8String } from 'ethers/lib/utils';
const {useApp, usePhysics, useLocalPlayer, useFrame, useLoaders, useInstancing, useAtlasing, useCleanup, useWorld, useLodder, useProcGenManager} = metaversefile;

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localBox = new THREE.Box3();

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');

//#region ASSETS TO BE IMPORTED
const glbSpecs = [
  {
    type: 'object',
    url: `${baseUrl}plants.glb`,
  },
  
  {
    type: 'object',
    url: `${baseUrl}rocks.glb`,
  }, 
  {
    type: 'plant',
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

//

// TAKE ONLY 2 FNS FROM USE INSTANCING
const {InstancedBatchedMesh, InstancedGeometryAllocator} = useInstancing();
const {createTextureAtlas} = useAtlasing();


class VegetationMesh extends InstancedBatchedMesh {
  constructor({
    procGenInstance,
    lodMeshes = [],
    shapeAddresses = [],
    physics = null,
  } = {}) {

    // instancing
    const {
      atlasTextures,
      geometries: lod0Geometries,
    } = createTextureAtlas(lodMeshes.map(lods => lods[0]), {
      textures: ['map', 'normalMap'],
      attributes: ['position', 'normal', 'uv'],
    });

    // allocator

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
    this.meshes = lodMeshes;
    this.shapeAddresses = shapeAddresses;
    this.physics = physics;
    this.drawCalls = new Map();
    this.physicsObjects = [];
  }

  drawChunk(chunk, renderData, tracker){
    const {
      vegetationData,
    } = renderData;
    const _renderVegetationGeometry = (drawCall, ps, qs, index) => {
      // geometry
      const pTexture = drawCall.getTexture('p');
      const pOffset = drawCall.getTextureOffset('p');
      const qTexture = drawCall.getTexture('q');
      const qOffset = drawCall.getTextureOffset('q');

      pTexture.image.data.set(ps, pOffset);
      qTexture.image.data.set(qs, qOffset);

      drawCall.updateTexture('p', pOffset, ps.length);
      drawCall.updateTexture('q', qOffset, qs.length);

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

      drawCall.updateTexture('p', pOffset / 3, 1);
      drawCall.updateTexture('q', qOffset / 4, 1);

      drawCall.incrementInstanceCount();

      // // physics
      const shapeAddress = this.#getShapeAddress(drawCall.geometryIndex);
      const physicsObject = this.#addPhysicsShape(shapeAddress, px, py, pz, qx, qy, qz, qw);
      this.physicsObjects.push(physicsObject);
    };


    // create drawcalls per chunk
    const drawCalls = new Map();
    for (let i = 0; i < vegetationData.instances.length; i++) {
      const geometryNoise = vegetationData.instances[i];
      const geometryIndex = Math.floor(geometryNoise * this.meshes.length);
      
      let drawCall = drawCalls.get(geometryIndex);
      if (!drawCall) {
        localBox.setFromCenterAndSize(
          localVector.set(
            (chunk.x + 0.5) * chunkWorldSize,
            (chunk.y + 0.5) * chunkWorldSize,
            (chunk.z + 0.5) * chunkWorldSize
          ),
          localVector2.set(chunkWorldSize, chunkWorldSize * 256, chunkWorldSize)
        );
        drawCall = this.allocator.allocDrawCall(geometryIndex, localBox);
        drawCalls.set(geometryIndex, drawCall);
      }
      _renderVegetationGeometry(drawCall, vegetationData.ps, vegetationData.qs, i);
    }
    const onchunkremove = e => {
      const {chunk: removeChunk} = e.data;
      if (chunk.equalsNodeLod(removeChunk)) {
        drawCalls.forEach((drawCall) => { 
          this.allocator.freeDrawCall(drawCall);
        } );
        tracker.removeEventListener('chunkremove', onchunkremove);
      }
    };
    tracker.addEventListener('chunkremove', onchunkremove);

  }
  
  #getShapeAddress(geometryIndex) {
    return this.shapeAddresses[geometryIndex];
  }
  #addPhysicsShape(shapeAddress, px, py, pz, qx, qy, qz, qw) {    
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
    const physicsObject = this.physics.addConvexShape(shapeAddress, position, quaternion, scale, dynamic, external);
  
    this.physicsObjects.push(physicsObject);

    return physicsObject;
  }
  getPhysicsObjects() {
    return this.physicsObjects;
  }
}

class VegetationChunkGenerator {
  constructor(parent, {
    procGenInstance = null,
    lodMeshes = [],
    shapeAddresses = [],
    physics = null,
  } = {}) {
    // parameters
    this.parent = parent;

    // mesh
    this.mesh = new VegetationMesh({
      procGenInstance,
      lodMeshes,
      shapeAddresses,
      physics,
    });
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

export default e => {
  const app = useApp();
  const physics = usePhysics();
  const procGenManager = useProcGenManager();

  app.name = 'vegetation';

  const seed = app.getComponent('seed') ?? null;
  let range = app.getComponent('range') ?? null;
  const wait = app.getComponent('wait') ?? false;

  if (range) {
    range = new THREE.Box3(
      new THREE.Vector3(range[0][0], range[0][1], range[0][2]),
      new THREE.Vector3(range[1][0], range[1][1], range[1][2])
    );
  }

  const frameFns = [];
  useFrame(({timestamp, timeDiff}) => {
    for (const frameFn of frameFns) {
      frameFn(timestamp, timeDiff);
    }
  });

  const cleanupFns = [];
  useCleanup(() => {
    for (const cleanupFn of cleanupFns) {
      cleanupFn();
    }
  });

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

    // generator

    const procGenInstance = procGenManager.getInstance(seed, range);

    generator = new VegetationChunkGenerator(this, {
      procGenInstance,
      lodMeshes,
      shapeAddresses,
      physics
    });
    //console.log(generator);
    const numLods = 3;
    tracker = procGenInstance.getChunkTracker({
      numLods,
      // trackY: true,
      //relod: true,
    });

    const chunkdatarequest = (e) => {
      const {chunk, waitUntil, signal} = e.data;
      const {lod} = chunk;

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
          vegetationData,
        ] = await Promise.all([
          _getVegetationData(),
        ]);
  
        /* const renderData = await generator.waterMesh.getChunkRenderData(
          chunk,
          signal
        ); */
        signal.throwIfAborted();
  
        return {
          vegetationData,
        };
      })();
      waitUntil(loadPromise);
    };

    const chunkAdd = e =>{
      const {renderData,chunk} = e.data;
      generator.mesh.drawChunk(chunk, renderData, tracker);
    }

    tracker.addEventListener('chunkadd', chunkAdd);
    tracker.addEventListener('chunkdatarequest', chunkdatarequest);


    const chunksMesh = generator.getChunks();
    app.add(chunksMesh);
    chunksMesh.updateMatrixWorld();


    const coordupdate = e => {
      const {coord} = e.data;
      chunksMesh.updateCoord(coord);
    };
    tracker.addEventListener('coordupdate', coordupdate);



    cleanupFns.push(() => {
      tracker.destroy();
    });

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
    if (tracker && !range) {
      const localPlayer = useLocalPlayer();
      tracker.update(localPlayer.position);
    }
  });

  useCleanup(()=>{
    tracker.destroy();
  })
  
  // callbacks

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  return app;
};
