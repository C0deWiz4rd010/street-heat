import * as THREE from "three";
import { DISTRICTS, REPUTATION_GAINS, TAGS_PER_DISTRICT } from "../config.js";
import { generateTags } from "../progression.js";
import { distanceSq } from "../util/math.js";

/** Graffiti tags: 10 per district, picked up by driving close. Collected ids live in state.tags (saved). */
export function createTagSystem({ state, scene, world, getDistrictAt, addCash, addReputation, addScore, refreshProgress, setStatus, spawnParticle, spawnPopup }) {
    // ---- Graffiti tags: 10 per district, picked up by driving close. -------------------------------
    const tagDefs = generateTags({
        buildings: world.buildings,
        districtIds: DISTRICTS.map((district) => district.id),
        districtIdOf: (x, z) => getDistrictAt(x, z).id,
        perDistrict: TAGS_PER_DISTRICT,
    });
    const tagGeometry = new THREE.PlaneGeometry(2.4, 1.5).rotateX(-Math.PI / 2);
    const tagMaterials = Object.fromEntries(DISTRICTS.map((district) => [
        district.id,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(district.color).multiplyScalar(2.2), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    ]));
    const tags = tagDefs.map((def, index) => {
        const mesh = new THREE.Mesh(tagGeometry, tagMaterials[def.districtId]);
        mesh.position.set(def.x, def.y, def.z);
        mesh.rotation.y = (index * 1.7) % Math.PI;
        scene.add(mesh);
        return { ...def, mesh, collected: state.tags.includes(def.id) };
    });
    for (const tag of tags) tag.mesh.visible = !tag.collected;
    world.tags = tags;

    function update(dt) {
        const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 280);
        for (const material of Object.values(tagMaterials)) material.opacity = 0.55 + 0.4 * pulse;
        for (const tag of tags) {
            if (tag.collected) continue;
            tag.mesh.position.y = tag.y + (tag.roof ? Math.sin(performance.now() / 500 + tag.x) * 0.12 : 0);
            if (distanceSq(state.player.x, state.player.z, tag.x, tag.z) > 4.2 * 4.2) continue;
            tag.collected = true;
            tag.mesh.visible = false;
            state.tags.push(tag.id);
            state.stats.tagsRun += 1;
            const district = DISTRICTS.find((entry) => entry.id === tag.districtId);
            const owned = tags.filter((entry) => entry.districtId === tag.districtId && entry.collected).length;
            addScore(150, false, "other");
            const cash = addCash(40);
            addReputation(tag.districtId, REPUTATION_GAINS.tag);
            spawnParticle(tag.x, tag.z, district?.color ?? "#ffffff", 14);
            setStatus(`Graffiti-Tag ${owned}/${TAGS_PER_DISTRICT} in ${district?.name}. +$${cash}`, 1.8);
            if (owned === TAGS_PER_DISTRICT) {
                addCash(500);
                addReputation(tag.districtId, REPUTATION_GAINS.tagSet);
                spawnPopup(`${district?.name.toUpperCase()} KOMPLETT`, "bounty");
                setStatus(`Alle Tags in ${district?.name} gesprüht! Bonus +$500.`, 3.5);
            }
            refreshProgress();
        }
    }

    return { tags, update };
}
