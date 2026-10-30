import { CONFIG } from "../config.js";
import { insideBuilding } from "../world.js";

/** Intersection graph of the street grid: one node per crossing, edges along the streets. */
export function buildRoadGraph(streets = CONFIG.map.streets) {
    const nodes = [];
    const size = streets.length;
    for (let i = 0; i < size; i += 1) {
        for (let j = 0; j < size; j += 1) {
            nodes.push({ id: i * size + j, i, j, x: streets[i], z: streets[j], links: [] });
        }
    }
    for (const node of nodes) {
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = node.i + di;
            const nj = node.j + dj;
            if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
            node.links.push(nodes[ni * size + nj]);
        }
    }
    return { nodes, size, streets };
}

export function nearestNode(graph, x, z) {
    let best = graph.nodes[0];
    let bestDist = Infinity;
    for (const node of graph.nodes) {
        const d = (node.x - x) ** 2 + (node.z - z) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = node;
        }
    }
    return best;
}

/** A* over the intersection graph. Returns the node list from `start` to `goal` (inclusive). */
export function findPath(graph, start, goal) {
    if (start === goal) return [start];
    const open = new Set([start]);
    const cameFrom = new Map();
    const g = new Map([[start, 0]]);
    const f = new Map([[start, heuristic(start, goal)]]);
    while (open.size) {
        let current = null;
        let currentF = Infinity;
        for (const node of open) {
            const score = f.get(node) ?? Infinity;
            if (score < currentF) {
                currentF = score;
                current = node;
            }
        }
        if (current === goal) {
            const path = [current];
            while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0]));
            return path;
        }
        open.delete(current);
        for (const next of current.links) {
            const tentative = g.get(current) + Math.hypot(next.x - current.x, next.z - current.z);
            if (tentative < (g.get(next) ?? Infinity)) {
                cameFrom.set(next, current);
                g.set(next, tentative);
                f.set(next, tentative + heuristic(next, goal));
                open.add(next);
            }
        }
    }
    return [start];
}

function heuristic(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Samples the segment against the building grid; true when no building blocks the view. */
export function hasLineOfSight(world, ax, az, bx, bz, step = 2.5) {
    const dx = bx - ax;
    const dz = bz - az;
    const distance = Math.hypot(dx, dz);
    const samples = Math.ceil(distance / step);
    for (let i = 1; i < samples; i += 1) {
        const t = i / samples;
        if (insideBuilding(world, ax + dx * t, az + dz * t, 0.2)) return false;
    }
    return true;
}

/**
 * Next point a cop should steer to when it has no clear line to `target`: the first graph node on the
 * A* route that is not already reached. Falls back to the target itself on the same block.
 */
export function nextWaypoint(graph, fromX, fromZ, targetX, targetZ, reachRadius = 5) {
    const start = nearestNode(graph, fromX, fromZ);
    const goal = nearestNode(graph, targetX, targetZ);
    const path = findPath(graph, start, goal);
    for (const node of path) {
        if (Math.hypot(node.x - fromX, node.z - fromZ) > reachRadius) return { x: node.x, z: node.z, path };
    }
    return { x: targetX, z: targetZ, path };
}
