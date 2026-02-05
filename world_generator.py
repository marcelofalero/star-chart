import random
import json
import csv
import requests
import time
from typing import Dict, Any

# --- Configuration ---
NUM_SYSTEMS = 1000
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "deepseek-r1"

# --- Lore Constants ---
STAR_TYPES = ["Red Dwarf"] * 60 + ["G/K Type"] * 30 + ["Exotic"] * 10

CLIMATE_BANDS = [
    "Scorched Equator",
    "Temperate Band",
    "Polar Archipelago",
    "Glass Deserts",
    "Fungal Tundra",
    "Acidic Seas",
    "Clockwork Plains"
]

ATMOSPHERES = [
    "Thin/Argon", "Toxic/Sulfur", "Breathable/Nitrogen-Rich", "Dense/Carbon-Dioxide", "Trace/Vacuum", "Corrosive/Acidic", "Hallucinogenic/Spore-Laden"
]

HYDROSPHERES = [
    "Frozen", "Liquid Methane", "Water", "None", "Subsurface Ocean", "Heavy Metal Sludge"
]

BIOSPHERES = [
    "Silicon-based", "Carbon-fungal", "Mechanized", "Sterile", "Mega-Flora", "Insectoid-Hive", "Translucent-Gelatinous"
]

SATELLITE_TYPES = [
    "Shattered Moon", "Artificial Ring", "Captured Asteroid", "Binary Moon System", "None", "Debris Field (Ancient War)"
]

ARCHETYPES = [
    "The Spire (Core World/High Prestige)",
    "The Foundry (Industrial/Polluted)",
    "The Rust Belt (Decaying)",
    "The Watchtower (Militarized Border)",
    "The Tomb (Severed System)"
]

GATE_STATUS = ["Active", "Restricted (Toll/Permit)", "Severed"]

FORBIDDEN_KEYWORDS = ["Tatooine", "Skywalker", "Jedi", "Sith", "Coruscant", "standard desert", "generic"]

class SystemGenerator:
    def __init__(self):
        self.systems = []

    def generate_physics(self) -> Dict[str, Any]:
        """Generates the physical characteristics of the system."""
        star_type = random.choice(STAR_TYPES)
        # 3 Climatic Bands
        geography = random.sample(CLIMATE_BANDS, 3)
        atmosphere = random.choice(ATMOSPHERES)
        hydrosphere = random.choice(HYDROSPHERES)
        biosphere = random.choice(BIOSPHERES)

        # Satellites logic: 70% chance of having satellites
        if random.random() < 0.7:
            satellites = random.sample(SATELLITE_TYPES, k=random.randint(1, 2))
            if "None" in satellites: satellites.remove("None") # Clean up if sampled
            if not satellites: satellites = ["None"]
        else:
            satellites = ["None"]

        return {
            "star_type": star_type,
            "geography": geography,
            "atmosphere": atmosphere,
            "hydrosphere": hydrosphere,
            "biosphere": biosphere,
            "satellites": satellites
        }

    def generate_society(self) -> Dict[str, Any]:
        """Generates the societal characteristics."""
        archetype = random.choice(ARCHETYPES)
        gate_status = random.choice(GATE_STATUS)
        tension_index = random.randint(0, 100)

        if "Spire" in archetype:
            prestige = random.randint(7, 10)
        elif "Rust Belt" in archetype or "Foundry" in archetype:
            prestige = random.randint(1, 5)
        else:
            prestige = random.randint(1, 10)

        return {
            "archetype": archetype,
            "gate_status": gate_status,
            "tension_index": tension_index,
            "prestige_score": prestige
        }

class NarrativeEngine:
    def __init__(self, use_mock=False):
        self.use_mock = use_mock

    def construct_prompt(self, physics: Dict, society: Dict) -> str:
        return f"""
        Role: Sci-Fi Writer/Creative Director.
        Setting: The Fabricators (Aesthetic Technocracy) vs The Ascendancy (Bio-mechanical Cult).
        Task: Create a solar system description.

        System Data:
        - Star: {physics['star_type']}
        - Geography: {', '.join(physics['geography'])}
        - Atmosphere: {physics['atmosphere']}
        - Hydrosphere: {physics['hydrosphere']}
        - Biosphere: {physics['biosphere']}
        - Satellites: {', '.join(physics['satellites'])}
        - Archetype: {society['archetype']}
        - Tension Index (Forgers vs Cognitics): {society['tension_index']}/100
        - Prestige Score: {society['prestige_score']}/10 (10 = Pure Art/Useless, 1 = Pure Function/Ugly)

        Requirements:
        Return ONLY a JSON object with these keys:
        1. "visual_style": Short phrase (e.g. "Art Deco Spires").
        2. "major_monument": A specific prestige project built by Fabricators.
        3. "secret_shadow_tag": A hidden plot hook (Architect or Invaders).
        4. "description": 2-3 sentences contrasting the "Glistering" surface with rotting foundation. Incorporate the atmosphere or satellite details if dramatic.

        Crucial: Do NOT use generic sci-fi tropes like "Tatooine" or "Desert Planet". Be weird, baroque, and dark.
        """

    def generate_mock_narrative(self, physics: Dict, society: Dict) -> Dict[str, str]:
        """Fallback if LLM is unavailable."""
        return {
            "visual_style": f"Mock-Baroque {society['archetype'].split()[1]} Style",
            "major_monument": "A placeholder obelisk of infinite bureaucracy.",
            "secret_shadow_tag": "The Architect's mock data injection found in the core.",
            "description": f"The surface of this {physics['star_type']} system glimmers with fake data. Beneath the {physics['atmosphere'].lower()} sky, the simulation rots."
        }

    def generate_narrative(self, physics: Dict, society: Dict) -> Dict[str, str]:
        if self.use_mock:
            return self.generate_mock_narrative(physics, society)

        prompt = self.construct_prompt(physics, society)
        payload = {
            "model": MODEL_NAME,
            "prompt": prompt,
            "stream": False,
            "format": "json"
        }

        retries = 3
        for attempt in range(retries):
            try:
                response = requests.post(OLLAMA_URL, json=payload, timeout=30)
                if response.status_code == 200:
                    data = response.json()
                    content = data.get("response", "")

                    # Parse JSON
                    try:
                        narrative_data = json.loads(content)
                    except json.JSONDecodeError:
                        print(f"JSON Decode Error on attempt {attempt+1}. Retrying...")
                        continue

                    # Safety Valve Check
                    combined_text = str(narrative_data).lower()
                    if any(bad_word in combined_text for bad_word in FORBIDDEN_KEYWORDS):
                        print(f"Safety Valve Triggered: Found forbidden trope. Re-rolling...")
                        continue # Retry

                    return narrative_data
                else:
                    print(f"API Error: {response.status_code}")
            except requests.RequestException as e:
                print(f"Connection Error: {e}")
                break # If connection fails, likely no LLM running.

        print("Falling back to Mock Data due to failures.")
        return self.generate_mock_narrative(physics, society)

def main():
    print(f"Initializing World Generator for {NUM_SYSTEMS} systems...")

    # Check connectivity
    use_mock = False
    try:
        requests.get("http://localhost:11434", timeout=1)
        print("Connected to Ollama.")
    except requests.RequestException:
        print("Could not connect to Ollama. Using Mock Mode.")
        use_mock = True

    sys_gen = SystemGenerator()
    narrative_gen = NarrativeEngine(use_mock=use_mock)

    galaxy_data = []

    for i in range(NUM_SYSTEMS):
        if i % 100 == 0:
            print(f"Generating system {i+1}/{NUM_SYSTEMS}...")

        physics = sys_gen.generate_physics()
        society = sys_gen.generate_society()
        narrative = narrative_gen.generate_narrative(physics, society)

        system_entry = {
            "id": i + 1,
            "name": f"System-{i+1:04d}", # Simple naming convention
            **physics,
            **society,
            **narrative
        }
        galaxy_data.append(system_entry)

    # Save to JSON
    with open("galaxy_data.json", "w") as f:
        json.dump(galaxy_data, f, indent=2)
    print("Saved galaxy_data.json")

    # Save to CSV
    # Column A: System Name
    # Column B: Prestige Score
    # Column C: Gate Status
    # Column D: Description
    with open("galaxy_manifest.csv", "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["System Name", "Prestige Score", "Gate Status", "Description"])
        for sys in galaxy_data:
            writer.writerow([
                sys["name"],
                sys["prestige_score"],
                sys["gate_status"],
                sys["description"]
            ])
    print("Saved galaxy_manifest.csv")
    print("Mission Complete.")

if __name__ == "__main__":
    main()
