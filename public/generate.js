const fs = require('fs');
const path = require('path');

const NUM_PLANETS = 60;
const FACTION_COUNT = 5;

const planets = [];
const routes = [];

const names_part1 = ["Alpha", "Beta", "Nova", "Iron", "Sol", "Valkaran", "Magellan", "Xen", "Chrysalis", "Vex", "Syndicate", "Bastion", "Shield", "Fortress", "Ghost", "Scrap", "Dead", "Centauri", "Sirius", "Vega", "Rigel", "Deneb"];
const names_part2 = ["Prime", "Cascadia", "Hold", "Nexus", "Core", "Hub", "Rest", "Wall", "Yard", "Zone", "Station", "Major", "Minor", "Sector", "Reach"];

for (let i = 1; i <= NUM_PLANETS; i++) {
    const p1 = names_part1[Math.floor(Math.random() * names_part1.length)];
    const p2 = names_part2[Math.floor(Math.random() * names_part2.length)];

    planets.push({
        planetId: i,
        name: `${p1} ${p2} ${i}`,
        x: (Math.random() - 0.5) * 80, // spread them across -40 to 40
        y: (Math.random() - 0.5) * 40,
        z: (Math.random() - 0.5) * 40,
        factionId: Math.floor(Math.random() * FACTION_COUNT) + 1,
        size: 0.6 + Math.random() * 0.8,
        description: `Procedurally generated test world ${i}.`
    });
}

// 1. Prim's algorithm for Minimum Spanning Tree to ensure fully connected graph
const connected = new Set([planets[0].planetId]);
const unconnected = new Set(planets.map(p => p.planetId).slice(1));

while (unconnected.size > 0) {
    let shortestDist = Infinity;
    let closestFrom = null;
    let closestTo = null;

    for (const fromId of connected) {
        const fromP = planets.find(p => p.planetId === fromId);
        for (const toId of unconnected) {
            const toP = planets.find(p => p.planetId === toId);
            const dist = Math.sqrt(Math.pow(fromP.x - toP.x, 2) + Math.pow(fromP.y - toP.y, 2) + Math.pow(fromP.z - toP.z, 2));
            if (dist < shortestDist) {
                shortestDist = dist;
                closestFrom = fromId;
                closestTo = toId;
            }
        }
    }

    connected.add(closestTo);
    unconnected.delete(closestTo);
    routes.push({
        routeId: routes.length + 1,
        fromId: closestFrom,
        toId: closestTo,
        security: ["High", "Medium", "Low"][Math.floor(Math.random() * 3)],
        distance: parseFloat(shortestDist.toFixed(2))
    });
}

// 2. Add some additional random proximity connections to create cycles and alternate routes
for (let i = 0; i < planets.length; i++) {
    const p1 = planets[i];

    const dists = planets.map(p2 => {
        if (p1.planetId === p2.planetId) return { id: p2.planetId, d: Infinity };
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = p1.z - p2.z;
        return { id: p2.planetId, d: Math.sqrt(dx * dx + dy * dy + dz * dz) };
    });

    dists.sort((a, b) => a.d - b.d);

    const additionalConnections = Math.floor(Math.random() * 2) + 1; // 1 to 2 extra connections
    for (let j = 0; j < additionalConnections; j++) {
        const toId = dists[j].id;

        const exists = routes.find(r =>
            (r.fromId === p1.planetId && r.toId === toId) ||
            (r.fromId === toId && r.toId === p1.planetId)
        );

        if (!exists) {
            routes.push({
                routeId: routes.length + 1,
                fromId: p1.planetId,
                toId: toId,
                security: ["High", "Medium", "Low"][Math.floor(Math.random() * 3)],
                distance: parseFloat(dists[j].d.toFixed(2))
            });
        }
    }
}

fs.writeFileSync(path.join(__dirname, 'data/planets.json'), JSON.stringify(planets, null, 2));
fs.writeFileSync(path.join(__dirname, 'data/routes.json'), JSON.stringify(routes, null, 2));

console.log(`Generated ${planets.length} planets and ${routes.length} routes.`);
