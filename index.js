import * as THREE from 'three';
import metaversefile from 'metaversefile';
const {useApp, useProcGen, useLocalPlayer, useFrame, useActivate, useLoaders, useMeshLodder, useMeshes, useCleanup, useWorld, useLodder, useDcWorkerManager, useGeometryAllocators, useMaterials} = metaversefile;

const baseUrl = import.meta.url.replace(/(\/)[^\/\\]*$/, '$1');
const glbSpecs = [
  /* {
    type: 'object',
    url: `${baseUrl}plants.glb`,
  },
  {
    type: 'object',
    url: `${baseUrl}rocks.glb`,
  }, */
  {
    type: 'plant',
    url: `${baseUrl}trees.glb`,
  },
];

const chunkWorldSize = 16;
const maxInstancesPerDrawCall = 128;
const maxDrawCallsPerGeometry = 32;
const numLods = 1;
const maxAnisotropy = 16;

const geometryAttributeKeys = ['position', 'normal', 'uv'];

//

const {BatchedMesh} = useMeshes();
class VegetationMesh extends BatchedMesh {
  constructor({
    meshes = [],
  } = {}) {
    const {InstancedGeometryAllocator} = useGeometryAllocators();

    // textures

    const {generateTextureAtlas, mapWarpedUvs, defaultTextureSize} = useMeshLodder();
    const textureSpecs = {
      map: meshes.map(m => m.material.map),
      normalMap: meshes.map(m => m.material.normalMap),
    };
    const {
      atlas,
      atlasImages,
      atlasTextures,
    } = generateTextureAtlas(textureSpecs);
    const canvasSize = Math.min(atlas.width, defaultTextureSize);
    const canvasScale = canvasSize / atlas.width;

    // geometry

    const geometries = meshes.map(m => m.geometry);
    for (let i = 0; i < geometries.length; i++) {
      const srcGeometry = geometries[i];

      const geometry = new THREE.BufferGeometry();
      for (const k of geometryAttributeKeys) {
        if (['position', 'normal', 'uv'].includes(k)) {
          const attr = srcGeometry.attributes[k];
          geometry.setAttribute(k, attr);
        }
      }
      geometry.setIndex(srcGeometry.index);

      const rect = atlas.rectIndexCache.get(i);
      const {x, y, width: w, height: h} = rect;
      const tx = x * canvasScale;
      const ty = y * canvasScale;
      const tw = w * canvasScale;
      const th = h * canvasScale;

      mapWarpedUvs(geometry.attributes.uv, 0, geometry.attributes.uv, 0, tx, ty, tw, th, canvasSize);
    
      geometries[i] = geometry;
    }

    const allocator = new InstancedGeometryAllocator(geometries, [
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

    this.meshes = meshes;
  }
  async addChunk(chunk, {
    signal,
  } = {}) {
    if (chunk.y === 0) {
      let live = true;
      signal.addEventListener('abort', e => {
        live = false;
      });
    
      const _getVegetationData = async () => {
        const dcWorkerManager = useDcWorkerManager();
        const lod = 1;
        const result = await dcWorkerManager.createVegetationSplat(chunk.x * chunkWorldSize, chunk.z * chunkWorldSize, lod);
        return result;
      };
      const result = await _getVegetationData();
      if (!live) return;

      const _renderVegetationGeometry = (drawCall, ps, qs, index) => {
        const pTexture = drawCall.getTexture('p');
        const pOffset = drawCall.getTextureOffset('p');
        const qTexture = drawCall.getTexture('q');
        const qOffset = drawCall.getTextureOffset('q');

        const instanceCount = drawCall.getInstanceCount();
        pTexture.image.data[pOffset + instanceCount * 3] = ps[index * 3];
        pTexture.image.data[pOffset + instanceCount * 3 + 1] = ps[index * 3 + 1];
        pTexture.image.data[pOffset + instanceCount * 3 + 2] = ps[index * 3 + 2];

        qTexture.image.data[qOffset + instanceCount * 4] = qs[index * 4];
        qTexture.image.data[qOffset + instanceCount * 4 + 1] = qs[index * 4 + 1];
        qTexture.image.data[qOffset + instanceCount * 4 + 2] = qs[index * 4 + 2];
        qTexture.image.data[qOffset + instanceCount * 4 + 3] = qs[index * 4 + 3];

        drawCall.updateTexture('p', pOffset, ps.length);
        drawCall.updateTexture('q', qOffset, qs.length);

        drawCall.incrementInstanceCount();
      };

      const drawCalls = new Map();
      for (let i = 0; i < result.instances.length; i++) {
        const geometryNoise = result.instances[i];
        const geometryIndex = Math.floor(geometryNoise * this.meshes.length);
        
        let drawCall = drawCalls.get(geometryIndex);
        if (!drawCall) {
          drawCall = this.allocator.allocDrawCall(geometryIndex);
          drawCalls.set(geometryIndex, drawCall);
        }
        _renderVegetationGeometry(drawCall, result.ps, result.qs, i);
      }

      signal.addEventListener('abort', e => {
        for (const drawCall of drawCalls.values()) {
          this.allocator.freeDrawCall(drawCall);
        }
      });
    }
  }
  getPhysicsObjects() {
    return []; // XXX bugfix physics support
  }
  update() {
    // nothing
  }
}

class VegetationChunkGenerator {
  constructor(parent, {
    meshes = [],
  } = {}) {
    // parameters
    this.parent = parent;

    // mesh
    this.mesh = new VegetationMesh({
      meshes,
    });
  }
  getChunks() {
    return this.mesh;
  }
  getPhysicsObjects() {
    return this.mesh.getPhysicsObjects();
  }
  generateChunk(chunk) {
    const abortController = new AbortController();
    const {signal} = abortController;
    
    (async () => {
      this.mesh.addChunk(chunk, {
        signal,
      });
    })();    

    chunk.binding = {
      abortController,
    };
  }
  disposeChunk(chunk) {
    const {abortController} = chunk.binding;
    abortController.abort();
    chunk.binding = null;
  }
  update(timestamp, timeDiff) {
    this.mesh.update(timestamp, timeDiff);
  }
  destroy() {
    // nothing; the owning lod tracker disposes of our contents
  }
}

export default () => {
  const app = useApp();
  const world = useWorld();
  // const physics = usePhysics();
  const {LodChunkTracker} = useLodder();

  app.name = 'vegetation';

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
  (async () => {
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

    const meshes = [];
    for (const name in specs) {
      const spec = specs[name];
      const subMesh = spec.lods[0];
      meshes.push(subMesh);
    }

    generator = new VegetationChunkGenerator(this, {
      meshes,
    });
    tracker = new LodChunkTracker(generator, {
      chunkWorldSize,
      numLods,
    });

    const chunksMesh = generator.getChunks();
    app.add(chunksMesh);
    chunksMesh.updateMatrixWorld();

    cleanupFns.push(() => {
      tracker.destroy();
    });
  })();

  useFrame(({timestamp, timeDiff}) => {
    if (tracker) {
      const localPlayer = useLocalPlayer();
      tracker.update(localPlayer.position);
    }
    generator && generator.update(timestamp, timeDiff);
  });

  // callbacks

  app.getPhysicsObjects = () => generator ? generator.getPhysicsObjects() : [];

  return app;
};
