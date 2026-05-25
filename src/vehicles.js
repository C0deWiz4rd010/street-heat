import * as THREE from "three";

export function createMaterial(color, options = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? 0.38,
        metalness: options.metalness ?? 0.25,
        emissive: options.emissive ?? "#000000",
        emissiveIntensity: options.emissiveIntensity ?? 0,
        transparent: options.transparent ?? false,
        opacity: options.opacity ?? 1,
    });
}

export function addBox(group, size, position, material, cast = true, receive = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
}

export function createCar(model, sharedMaterials, options = {}) {
    const group = new THREE.Group();
    const bodyMat = createMaterial(options.bodyColor ?? model.color, { roughness: 0.24, metalness: 0.36 });
    const trimMat = createMaterial(options.trimColor ?? model.trim, { roughness: 0.32, metalness: 0.42 });
    const glassMat = sharedMaterials.glass;
    const accentMat = createMaterial(options.police ? "#f5f7fb" : "#f7f1de", {
        roughness: 0.18,
        metalness: 0.45,
    });
    const headlightMat = createMaterial("#fff6a8", { emissive: "#ffe56b", emissiveIntensity: 0.8 });
    const tailMat = createMaterial("#ff394b", { emissive: "#ff394b", emissiveIntensity: 0.65 });

    addBox(group, { x: model.width, y: model.height, z: model.length }, { x: 0, y: 0, z: 0 }, bodyMat);
    addBox(group, { x: model.width * 0.9, y: 0.26, z: model.length * 0.34 }, { x: 0, y: 0.46, z: -model.length * 0.02 }, glassMat);

    if (model.roof === "van") {
        addBox(group, { x: model.width * 0.88, y: 0.62, z: model.length * 0.58 }, { x: 0, y: 0.64, z: -0.22 }, trimMat);
    } else if (model.roof === "muscle") {
        addBox(group, { x: model.width * 0.82, y: 0.44, z: model.length * 0.42 }, { x: 0, y: 0.56, z: -0.12 }, trimMat);
        addBox(group, { x: model.width * 0.7, y: 0.14, z: 0.28 }, { x: 0, y: 0.48, z: model.length * 0.2 }, accentMat);
    } else if (model.roof === "sport") {
        addBox(group, { x: model.width * 0.82, y: 0.35, z: model.length * 0.34 }, { x: 0, y: 0.5, z: -0.1 }, trimMat);
        addBox(group, { x: model.width * 0.94, y: 0.12, z: 0.18 }, { x: 0, y: 0.52, z: -model.length * 0.48 }, trimMat);
    } else {
        addBox(group, { x: model.width * 0.82, y: 0.42, z: model.length * 0.43 }, { x: 0, y: 0.54, z: -0.04 }, trimMat);
    }

    addBox(group, { x: model.width * 0.28, y: 0.12, z: 0.12 }, { x: -model.width * 0.28, y: 0.04, z: model.length * 0.51 }, headlightMat, false, false);
    addBox(group, { x: model.width * 0.28, y: 0.12, z: 0.12 }, { x: model.width * 0.28, y: 0.04, z: model.length * 0.51 }, headlightMat, false, false);
    addBox(group, { x: model.width * 0.26, y: 0.12, z: 0.12 }, { x: -model.width * 0.3, y: 0.04, z: -model.length * 0.51 }, tailMat, false, false);
    addBox(group, { x: model.width * 0.26, y: 0.12, z: 0.12 }, { x: model.width * 0.3, y: 0.04, z: -model.length * 0.51 }, tailMat, false, false);

    const wheelGeo = sharedMaterials.wheelGeometry;
    const wheelOffsets = [
        [-model.width * 0.55, -0.22, model.length * 0.32],
        [model.width * 0.55, -0.22, model.length * 0.32],
        [-model.width * 0.55, -0.22, -model.length * 0.32],
        [model.width * 0.55, -0.22, -model.length * 0.32],
    ];

    for (const offset of wheelOffsets) {
        const wheel = new THREE.Mesh(wheelGeo, sharedMaterials.tire);
        wheel.position.set(offset[0], offset[1], offset[2]);
        wheel.rotation.z = Math.PI / 2;
        group.add(wheel);
    }

    if (options.police) {
        addBox(group, { x: model.width * 0.75, y: 0.16, z: 0.44 }, { x: 0, y: 0.96, z: 0 }, accentMat, false, false);
        addBox(group, { x: model.width * 0.35, y: 0.1, z: 0.4 }, { x: -model.width * 0.18, y: 1.02, z: 0 }, createMaterial("#326dff", { emissive: "#326dff", emissiveIntensity: 0.9 }), false, false);
        addBox(group, { x: model.width * 0.35, y: 0.1, z: 0.4 }, { x: model.width * 0.18, y: 1.02, z: 0 }, createMaterial("#ff344c", { emissive: "#ff344c", emissiveIntensity: 0.9 }), false, false);
    }

    if (options.taxi) {
        addBox(group, { x: model.width * 0.44, y: 0.18, z: 0.5 }, { x: 0, y: 0.93, z: 0.05 }, createMaterial("#f7f1de", { emissive: "#ffc64d", emissiveIntensity: 0.35 }), false, false);
    }

    group.userData.model = model;
    return group;
}

export function replaceCarModel(target, nextModel, sharedMaterials) {
    target.clear();
    const next = createCar(nextModel, sharedMaterials);
    while (next.children.length > 0) {
        target.add(next.children[0]);
    }
    target.userData.model = nextModel;
}
