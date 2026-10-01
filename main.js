
import {
  Engine,
  Scene,
  Vector3,
  Color4,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  FollowCamera,
  PhysicsAggregate,
  PhysicsShapeType
} from "@babylonjs/core";

import HavokPhysics from "@babylonjs/havok";

import {
  HavokPlugin
} from "@babylonjs/core/Physics/v2/Plugins/havokPlugin.js";

const canvas = document.querySelector("#game");

const engine = new Engine(canvas, true);
const scene = new Scene(engine);

scene.clearColor = new Color4(0.48, 0.69, 0.82, 1);

HavokPhysics().then((havok) => {

scene.enablePhysics(
  new Vector3(0, -9.81, 0),
  new HavokPlugin(true, havok)
);

new HemisphericLight(
  "sky",
  new Vector3(0, 1, 0),
  scene
).intensity = 0.95;

const mat = (name, color) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(color);
  return m;
};

const dirt = mat("dirt", "#68704b");
const orange = mat("paint", "#e87520");
const tire = mat("rubber", "#202326");
const rock = mat("rock", "#77766b");

// Mountain terrain
const ground = MeshBuilder.CreateGround(
  "terrain",
  {
    width: 180,
    height: 240,
    subdivisions: 100
  },
  scene
);

let p = ground.getVerticesData("position");

for (let i = 0; i < p.length; i += 3) {
  let x = p[i];
  let z = p[i + 2];

  p[i + 1] =
    Math.sin(x * 0.055) * 2.2 +
    Math.cos(z * 0.045) * 3 +
    Math.sin((x + z) * 0.035) * 2 +
    Math.max(0, z - 12) * 0.095;
}

ground.updateVerticesData("position", p);
ground.material = dirt;

new PhysicsAggregate(
  ground,
  PhysicsShapeType.MESH,
  {
    mass: 0,
    restitution: 0.05
  },
  scene
);

// Rocks
for (let i = 0; i < 28; i++) {
  let b = MeshBuilder.CreateBox(
    "boulder" + i,
    {
      width: 1 + Math.random() * 2,
      height: 1 + Math.random() * 1.6,
      depth: 1 + Math.random() * 2
    },
    scene
  );

  b.position.set(
    (Math.random() - 0.5) * 23,
    1,
    8 + i * 5
  );

  b.rotation.y = Math.random() * 3;
  b.material = rock;

  new PhysicsAggregate(
    b,
    PhysicsShapeType.BOX,
    { mass: 0 },
    scene
  );
}

// 4x4 vehicle
const car = MeshBuilder.CreateBox(
  "4x4",
  {
    width: 1.8,
    height: 0.65,
    depth: 3.1
  },
  scene
);

car.position.set(0, 4, -3);
car.material = orange;

const body = new PhysicsAggregate(
  car,
  PhysicsShapeType.BOX,
  {
    mass: 950,
    restitution: 0.05,
    friction: 0.8
  },
  scene
);

body.body.setAngularDamping(0.8);
body.body.setLinearDamping(0.12);

// Cabin
const cabin = MeshBuilder.CreateBox(
  "cabin",
  {
    width: 1.35,
    height: 0.65,
    depth: 1.45
  },
  scene
);

cabin.parent = car;
cabin.position.y = 0.62;
cabin.material = orange;

// Wheels
const wheels = [];

for (const x of [-0.9, 0.9]) {
  for (const z of [-1, 1]) {
    let w = MeshBuilder.CreateCylinder(
      "wheel",
      {
        diameter: 0.78,
        height: 0.28,
        tessellation: 18
      },
      scene
    );

    w.rotation.z = Math.PI / 2;
    w.parent = car;
    w.position.set(x, -0.12, z);
    w.material = tire;

    wheels.push(w);
  }
}

// Camera
const cam = new FollowCamera(
  "chase",
  new Vector3(0, 5, -10),
  scene
);

cam.radius = 10;
cam.heightOffset = 3.3;
cam.rotationOffset = 180;
cam.cameraAcceleration = 0.08;
cam.maxCameraSpeed = 20;
cam.lockedTarget = car;

// Controls
const keys = {
  gas: false,
  brake: false,
  left: false,
  right: false
};

document.querySelectorAll("[data-key]").forEach(btn => {
  let k = btn.dataset.key;

  btn.onpointerdown = e => {
    e.preventDefault();
    keys[k] = true;
  };

  for (let ev of [
    "pointerup",
    "pointercancel",
    "pointerleave"
  ]) {
    btn.addEventListener(ev, () => {
      keys[k] = false;
    });
  }
});

const map = {
  ArrowUp: "gas",
  w: "gas",
  ArrowDown: "brake",
  s: "brake",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right"
};

addEventListener("keydown", e => {
  if (map[e.key]) keys[map[e.key]] = true;
});

addEventListener("keyup", e => {
  if (map[e.key]) keys[map[e.key]] = false;
});

// Reset
document.querySelector("#reset").onclick = () => {
  body.body.setTargetTransform(
    new Vector3(0, 5, -3),
    car.rotationQuaternion ?? car.rotation
  );

  body.body.setLinearVelocity(Vector3.Zero());
  body.body.setAngularVelocity(Vector3.Zero());
};

// Game loop
engine.runRenderLoop(() => {
  let dt = engine.getDeltaTime() / 1000;

  let forward = car.forward.scale(-1);
  let v = body.body.getLinearVelocity();

  if (keys.gas) {
    body.body.applyImpulse(
      forward.scale(9500 * dt),
      car.getAbsolutePosition()
    );
  }

  if (keys.brake) {
    body.body.applyImpulse(
      forward.scale(-6500 * dt),
      car.getAbsolutePosition()
    );
  }

  let steer =
    (keys.left ? 1 : 0) -
    (keys.right ? 1 : 0);

  if (Math.abs(v.length()) > 0.3 && steer) {
    body.body.setAngularVelocity(
      new Vector3(
        0,
        steer * Math.min(1.8, v.length() * 0.18),
        0
      )
    );
  }

  wheels.forEach(w => {
    w.rotation.x += v.length() * dt * 1.4;
  });

  document.querySelector("#speed").textContent =
    Math.round(v.length() * 3.6);

  document.querySelector("#alt").textContent =
    Math.max(0, Math.round(car.position.y));

  scene.render();
});

addEventListener("resize", () => engine.resize());
