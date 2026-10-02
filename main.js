import { Engine, Scene, Vector3, Color3, HemisphericLight, DirectionalLight, 
         ShadowGenerator, ArcRotateCamera, MeshBuilder, StandardMaterial,
         PhysicsAggregate, PhysicsShapeType, Quaternion } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';

// ================== نظام مركبة Raycast الاحترافي ==================
class RaycastVehicle {
    constructor(scene, chassisMesh) {
        this.scene = scene;
        this.chassis = chassisMesh;
        
        // فيزياء الهيكل
        this.aggregate = new PhysicsAggregate(chassisMesh, PhysicsShapeType.BOX, {
            mass: 1200,
            friction: 0.5,
            restitution: 0.2
        }, scene);
        
        // معلومات العجلات الأربع
        this.wheelInfos = [
            { connectionPoint: new Vector3(-1.1, -0.5, 1.5), isFront: true, steer: 0, engine: false },
            { connectionPoint: new Vector3(1.1, -0.5, 1.5), isFront: true, steer: 0, engine: false },
            { connectionPoint: new Vector3(-1.1, -0.5, -1.5), isFront: false, steer: 0, engine: true },
            { connectionPoint: new Vector3(1.1, -0.5, -1.5), isFront: false, steer: 0, engine: true }
        ];
        
        // عجلات مرئية
        this.wheels = [];
        this.wheelInfos.forEach((info, i) => {
            const wheel = MeshBuilder.CreateCylinder(`wheel_${i}`, {
                diameter: 0.8,
                height: 0.35,
                tessellation: 20
            }, scene);
            wheel.rotation.z = Math.PI / 2;
            wheel.material = new StandardMaterial(`wheelMat_${i}`, scene);
            wheel.material.diffuseColor = new Color3(0.1, 0.1, 0.1);
            wheel.material.specularColor = new Color3(0.3, 0.3, 0.3);
            this.wheels.push(wheel);
        });
        
        // خصائص التعليق
        this.suspensionRestLength = 0.5;
        this.suspensionStiffness = 35;
        this.suspensionDamping = 3;
        this.wheelRadius = 0.4;
        this.maxSuspensionForce = 60000;
        this.maxSuspensionTravel = 0.3;
        
        // حالات التحكم
        this.engineForce = 0;
        this.brakeForce = 0;
        this.steerValue = 0;
        this.handbrake = false;
        
        // إحصائيات
        this.speed = 0;
        this.rpm = 0;
        this.gear = 'D';
        this.wheelOnGround = [false, false, false, false];
    }
    
    update(deltaTime) {
        if (!this.aggregate?.body) return;
        
        const body = this.aggregate.body;
        const transform = body.getTransformNode();
        const chassisPos = transform.getAbsolutePosition();
        const forward = transform.forward;
        const right = transform.right;
        const up = transform.up;
        
        let totalForce = Vector3.Zero();
        let totalTorque = Vector3.Zero();
        
        // حساب السرعة الحالية
        const vel = body.getLinearVelocity();
        this.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;
        
        this.wheelInfos.forEach((info, i) => {
            this.wheelOnGround[i] = false;
            
            // نقطة بداية الشعاع في إحداثيات العالم
            const connectionWorld = chassisPos.clone()
                .add(right.scale(info.connectionPoint.x))
                .add(up.scale(info.connectionPoint.y))
                .add(forward.scale(info.connectionPoint.z));
            
            // اتجاه الشعاع: نحو الأسفل بالنسبة للهيكل
            const rayDir = up.clone().scaleInPlace(-1);
            const rayLength = this.suspensionRestLength + this.wheelRadius + 0.5;
            const rayEnd = connectionWorld.clone().add(rayDir.scale(rayLength));
            
            // تنفيذ الشعاع الفيزيائي
            const hit = this.scene.getPhysicsEngine()?.raycast(connectionWorld, rayEnd);
            
            if (hit && hit.hasHit) {
                this.wheelOnGround[i] = true;
                const hitPoint = hit.hitPointWorld;
                const hitDistance = hitPoint.subtract(connectionWorld).length();
                const suspensionLength = hitDistance - this.wheelRadius;
                
                // 1. قوة التعليق (النابض)
                let compression = this.suspensionRestLength - suspensionLength;
                compression = Math.max(-this.maxSuspensionTravel, Math.min(this.maxSuspensionTravel, compression));
                
                if (compression > 0) {
                    // قوة النابض
                    let suspensionForce = compression * this.suspensionStiffness * 1000;
                    
                    // التخميد (damping)
                    const pointVelocity = body.getLinearVelocityAtPoint(connectionWorld);
                    const dampingForce = pointVelocity.dot(up) * this.suspensionDamping * 1000;
                    suspensionForce -= dampingForce;
                    
                    suspensionForce = Math.max(0, Math.min(suspensionForce, this.maxSuspensionForce));
                    
                    // تطبيق قوة التعليق نحو الأعلى
                    totalForce.addInPlace(up.scale(suspensionForce));
                    
                    // 2. قوة الاحتكاك الطولي (دفع/كبح)
                    let wheelForward = forward.clone();
                    
                    // توجيه العجلات الأمامية
                    if (info.isFront && Math.abs(this.steerValue) > 0.01) {
                        const steerQuat = Quaternion.RotationAxis(up, this.steerValue);
                        wheelForward = Vector3.TransformCoordinates(wheelForward, steerQuat.toRotationMatrix());
                    }
                    
                    // قوة المحرك (على العجلات الخلفية)
                    if (info.engine && Math.abs(this.engineForce) > 0) {
                        const engineVec = wheelForward.scale(this.engineForce / 2);
                        totalForce.addInPlace(engineVec);
                        totalTorque.addInPlace(Vector3.Cross(hitPoint.subtract(chassisPos), engineVec));
                    }
                    
                    // قوة الفرامل
                    if (this.brakeForce > 0) {
                        const pointVel = body.getLinearVelocityAtPoint(hitPoint);
                        const brakeVec = pointVel.scale(-this.brakeForce);
                        totalForce.addInPlace(brakeVec);
                    }
                    
                    // فرامل يدوية (توقف العجلات الخلفية تماماً)
                    if (this.handbrake && !info.isFront) {
                        const pointVel = body.getLinearVelocityAtPoint(hitPoint);
                        const handbrakeVec = pointVel.scale(-50);
                        totalForce.addInPlace(handbrakeVec);
                    }
                    
                    // 3. احتكاك جانبي لمنع الانزلاق
                    const lateralVel = body.getLinearVelocityAtPoint(hitPoint).dot(right);
                    const lateralForce = right.scale(-lateralVel * 8);
                    totalForce.addInPlace(lateralForce);
                    
                    // تحديث موقع العجلة المرئية
                    this.wheels[i].position = hitPoint.clone().add(up.scale(this.wheelRadius * 0.5));
                    this.wheels[i].rotationQuaternion = transform.rotationQuaternion;
                    
                    // تدوير العجلة حسب السرعة
                    if (this.speed > 1) {
                        const rollQuat = Quaternion.RotationAxis(right, this.speed * 0.05);
                        this.wheels[i].rotationQuaternion.multiplyInPlace(rollQuat);
                    }
                    
                    // توجيه مرئي للعجلات الأمامية
                    if (info.isFront) {
                        const steerVisual = Quaternion.RotationAxis(up, this.steerValue * 0.8);
                        this.wheels[i].rotationQuaternion.multiplyInPlace(steerVisual);
                    }
                }
            } else {
                // العجلة في الهواء
                this.wheels[i].position = connectionWorld.clone().add(rayDir.scale(this.suspensionRestLength));
                this.wheels[i].rotationQuaternion = transform.rotationQuaternion;
            }
        });
        
        // تطبيق القوى المجمعة
        body.applyForce(totalForce, chassisPos);
        body.applyTorque(totalTorque);
        
        // مقاومة هوائية
        const dragForce = vel.scale(-0.3);
        body.applyForce(dragForce, chassisPos);
        
        // منع الانقلاب التام
        const euler = transform.rotationQuaternion?.toEulerAngles();
        if (euler && (Math.abs(euler.x) > 1.4 || Math.abs(euler.z) > 1.4)) {
            body.setAngularVelocity(Vector3.Zero());
        }
    }
    
    setThrottle(value) {
        this.engineForce = value * 3000;
        this.rpm = Math.min(8000, Math.abs(value) * 6000 + 800);
    }
    
    setBrake(value) {
        this.brakeForce = value * 200;
    }
    
    setSteer(value) {
        this.steerValue = value * 0.45;
        this.wheelInfos[0].steer = this.steerValue;
        this.wheelInfos[1].steer = this.steerValue;
    }
    
    setHandbrake(active) {
        this.handbrake = active;
    }
    
    reset() {
        const body = this.aggregate.body;
        const transform = body.getTransformNode();
        transform.position.y += 2;
        transform.rotation = new Vector3(0, transform.rotation.y, 0);
        transform.rotationQuaternion = Quaternion.RotationYawPitchRoll(transform.rotation.y, 0, 0);
        body.setLinearVelocity(Vector3.Zero());
        body.setAngularVelocity(Vector3.Zero());
    }
}

// ================== متغيرات اللعبة ==================
let engine, scene, havokPlugin, camera, vehicle;
let inputState = { gas: false, brake: false, left: false, right: false, handbrake: false };
let cameraMode = 0;
let gameActive = false;

// ================== تهيئة اللعبة ==================
async function initGame() {
    try {
        updateLoadingStatus('تهيئة محرك الرسوميات...');
        const canvas = document.getElementById('renderCanvas');
        engine = new Engine(canvas, true, { 
            preserveDrawingBuffer: true, 
            stencil: true,
            powerPreference: 'high-performance'
        });
        scene = new Scene(engine);
        scene.clearColor = new Color3(0.5, 0.7, 0.9);
        
        // تفعيل فيزياء Havok
        updateLoadingStatus('تحميل محرك فيزياء Havok...');
        await initHavok();
        
        // بناء العالم
        updateLoadingStatus('بناء العالم الجبلي...');
        const shadowGen = createLighting(scene);
        createWorld(scene, shadowGen);
        
        // بناء السيارة
        updateLoadingStatus('تصنيع السيارة...');
        createDefaultVehicle(scene, shadowGen);
        
        // الكاميرا
        updateLoadingStatus('تهيئة الكاميرا...');
        setupCamera(canvas);
        
        // حلقة اللعبة
        scene.onBeforeRenderObservable.add(() => {
            if (vehicle && gameActive) {
                // تطبيق المدخلات
                vehicle.setThrottle(inputState.gas ? 1 : 0);
                vehicle.setBrake(inputState.brake ? 1 : 0);
                vehicle.setSteer((inputState.left ? 1 : 0) - (inputState.right ? 1 : 0));
                vehicle.setHandbrake(inputState.handbrake);
                
                // تحديث الفيزياء
                vehicle.update(engine.getDeltaTime() / 1000);
                
                // تحديث الكاميرا والـ HUD
                updateCamera();
                updateHUD();
            }
        });
        
        // إخفاء شاشة التحميل
        document.getElementById('splash-screen')?.classList.add('hidden');
        document.getElementById('main-menu')?.classList.remove('hidden');
        
        engine.runRenderLoop(() => scene.render());
        window.addEventListener('resize', () => engine.resize());
        
        console.log('✅ تم تحميل اللعبة بنجاح!');
        
    } catch (error) {
        console.error('❌ خطأ فادح:', error);
        showError('فشل تشغيل اللعبة', error.message);
    }
}

async function initHavok() {
    const wasmUrls = [
        'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.0/lib/esm/HavokPhysics.wasm',
        'https://unpkg.com/@babylonjs/havok@1.3.0/lib/esm/HavokPhysics.wasm'
    ];
    
    for (const url of wasmUrls) {
        try {
            const havokInstance = await HavokPhysics({
                locateFile: () => url
            });
            havokPlugin = new HavokPlugin(true, havokInstance);
            scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
            console.log('✅ Havok جاهز من:', url);
            return;
        } catch (e) {
            console.warn('⚠️ فشل من:', url);
        }
    }
    throw new Error('تعذر تحميل محرك فيزياء Havok');
}

function createLighting(scene) {
    const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.6;
    hemiLight.diffuse = new Color3(1, 0.98, 0.9);
    
    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(30, 50, 30);
    dirLight.intensity = 1.2;
    
    const shadowGen = new ShadowGenerator(1024, dirLight);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 16;
    
    return shadowGen;
}

function createWorld(scene, shadowGen) {
    // أرضية جبلية
    const ground = MeshBuilder.CreateGroundFromHeightMap('ground', 
        'https://assets.babylonjs.com/environments/heightMap.png', 
        { width: 200, height: 200, subdivisions: 80, minHeight: 0, maxHeight: 10 }, scene);
    
    ground.material = new StandardMaterial('groundMat', scene);
    ground.material.diffuseColor = new Color3(0.5, 0.4, 0.3);
    ground.material.specularColor = new Color3(0.1, 0.1, 0.1);
    ground.receiveShadows = true;
    
    // فيزياء الأرضية
    new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0, friction: 0.8 }, scene);
    
    // طريق
    const road = MeshBuilder.CreatePlane('road', { width: 8, height: 180 }, scene);
    road.rotation.x = Math.PI / 2;
    road.position.y = 0.2;
    road.material = new StandardMaterial('roadMat', scene);
    road.material.diffuseColor = new Color3(0.2, 0.2, 0.2);
    
    // صخور
    for (let i = 0; i < 25; i++) {
        const rock = MeshBuilder.CreateSphere(`rock_${i}`, { 
            diameter: 2 + Math.random() * 4, 
            segments: 6 
        }, scene);
        rock.position = new Vector3(
            (Math.random() - 0.5) * 160, 
            10, 
            (Math.random() - 0.5) * 160
        );
        rock.material = new StandardMaterial(`rockMat_${i}`, scene);
        rock.material.diffuseColor = new Color3(0.35, 0.33, 0.32);
        shadowGen.addShadowCaster(rock);
        new PhysicsAggregate(rock, PhysicsShapeType.SPHERE, { mass: 15, friction: 0.7 }, scene);
    }
    
    // أشجار بسيطة
    for (let i = 0; i < 30; i++) {
        const trunk = MeshBuilder.CreateCylinder(`trunk_${i}`, { 
            diameter: 0.5, height: 3, tessellation: 6 
        }, scene);
        const leaves = MeshBuilder.CreateSphere(`leaves_${i}`, { 
            diameter: 2.5, segments: 6 
        }, scene);
        leaves.position.y = 3;
        leaves.parent = trunk;
        
        trunk.position = new Vector3(
            (Math.random() - 0.5) * 180, 
            1.5, 
            (Math.random() - 0.5) * 180
        );
        trunk.material = new StandardMaterial(`trunkMat_${i}`, scene);
        trunk.material.diffuseColor = new Color3(0.4, 0.25, 0.1);
        leaves.material = new StandardMaterial(`leavesMat_${i}`, scene);
        leaves.material.diffuseColor = new Color3(0.1, 0.4, 0.1);
        
        shadowGen.addShadowCaster(trunk);
        shadowGen.addShadowCaster(leaves);
        new PhysicsAggregate(trunk, PhysicsShapeType.CYLINDER, { mass: 0 }, scene);
    }
}

function createDefaultVehicle(scene, shadowGen) {
    // هيكل السيارة
    const chassis = MeshBuilder.CreateBox('chassis', { width: 2, height: 0.9, depth: 4 }, scene);
    chassis.position.y = 2;
    chassis.material = new StandardMaterial('chassisMat', scene);
    chassis.material.diffuseColor = new Color3(0.9, 0.1, 0.1);
    shadowGen.addShadowCaster(chassis);
    
    // قمرة القيادة
    const cabin = MeshBuilder.CreateBox('cabin', { width: 1.8, height: 0.7, depth: 2 }, scene);
    cabin.position = new Vector3(0, 0.9, -0.3);
    cabin.parent = chassis;
    cabin.material = new StandardMaterial('cabinMat', scene);
    cabin.material.diffuseColor = new Color3(0.7, 0.05, 0.05);
    shadowGen.addShadowCaster(cabin);
    
    // زجاج
    const windshield = MeshBuilder.CreatePlane('windshield', { width: 1.6, height: 0.6 }, scene);
    windshield.position = new Vector3(0, 1.1, 0.7);
    windshield.rotation.x = -0.3;
    windshield.parent = chassis;
    windshield.material = new StandardMaterial('glassMat', scene);
    windshield.material.diffuseColor = new Color3(0.3, 0.5, 0.7);
    windshield.material.alpha = 0.5;
    
    vehicle = new RaycastVehicle(scene, chassis);
}

function setupCamera(canvas) {
    camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 12, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 25;
    camera.lowerBetaLimit = 0.3;
    camera.upperBetaLimit = Math.PI / 1.8;
}

function updateCamera() {
    if (!vehicle || !camera) return;
    const target = vehicle.chassis.position;
    
    switch (cameraMode) {
        case 0: // خارجية خلف السيارة
            camera.setTarget(target);
            camera.radius += (12 - camera.radius) * 0.05;
            camera.alpha += (Math.PI - camera.alpha) * 0.03;
            camera.beta += (Math.PI / 2.5 - camera.beta) * 0.05;
            break;
        case 1: // قمرة القيادة
            const cockpitPos = target.add(new Vector3(0, 1.2, 0.5));
            camera.position = cockpitPos;
            camera.setTarget(target.add(vehicle.chassis.forward.scale(20)));
            break;
        case 2: // علوية
            camera.position = target.add(new Vector3(0, 18, 0.1));
            camera.setTarget(target);
            break;
    }
}

function updateHUD() {
    if (!vehicle) return;
    document.getElementById('speedometer').innerText = Math.floor(vehicle.speed) + ' km/h';
    document.getElementById('gear-indicator').innerText = vehicle.gear;
}

// ================== واجهة المستخدم ==================
window.startGame = function(mode) {
    document.getElementById('main-menu')?.classList.add('hidden');
    document.getElementById('game-hud')?.classList.remove('hidden');
    gameActive = true;
    if (vehicle) vehicle.reset();
};

window.showMainMenu = function() {
    document.getElementById('game-hud')?.classList.add('hidden');
    document.getElementById('main-menu')?.classList.remove('hidden');
    gameActive = false;
};

window.resetCar = function() {
    if (vehicle) vehicle.reset();
};

window.toggleCamera = function() {
    cameraMode = (cameraMode + 1) % 3;
    console.log('📷 الكاميرا:', ['خلفية', 'قمرة القيادة', 'علوية'][cameraMode]);
};

window.showImport = function() {
    document.getElementById('import-panel')?.classList.remove('hidden');
};
window.closeImport = function() {
    document.getElementById('import-panel')?.classList.add('hidden');
};
window.showGarage = function() {
    document.getElementById('garage-panel')?.classList.remove('hidden');
};
window.closeGarage = function() {
    document.getElementById('garage-panel')?.classList.add('hidden');
};
window.toggleSettings = function() {
    alert('⚙️ الإعدادات قيد التطوير');
};
window.showMultiplayer = function() {
    alert('🌐 اللعب الجماعي يتطلب خادم محلي. قيد التطوير.');
};

window.changeCarColor = function(color) {
    if (vehicle?.chassis?.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function(type) {
    if (type === 'engine') console.log('ترقية المحرك');
    if (type === 'suspension') console.log('ترقية التعليق');
    alert('✅ تمت الترقية!');
};

// ================== ربط أزرار التحكم ==================
function bindButton(id, key) {
    const btn = document.getElementById(id);
    if (!btn) return;
    
    const activate = (e) => { e?.preventDefault(); inputState[key] = true; };
    const deactivate = (e) => { e?.preventDefault(); inputState[key] = false; };
    
    btn.addEventListener('touchstart', activate, { passive: false });
    btn.addEventListener('touchend', deactivate, { passive: false });
    btn.addEventListener('mousedown', activate);
    btn.addEventListener('mouseup', deactivate);
    btn.addEventListener('mouseleave', deactivate);
}

bindButton('btn-gas', 'gas');
bindButton('btn-brake', 'brake');
bindButton('btn-left', 'left');
bindButton('btn-right', 'right');

window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = true;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
    if (e.key === ' ') inputState.handbrake = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = false;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
    if (e.key === ' ') inputState.handbrake = false;
});

// ================== أدوات مساعدة ==================
function updateLoadingStatus(msg) {
    const el = document.querySelector('.loading-text');
    if (el) el.innerText = msg;
}

function showError(title, details) {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.innerHTML = `
            <div class="logo-container" style="text-align:center; padding:20px;">
                <h1 style="color:#e74c3c; font-size:2rem;">⚠️ ${title}</h1>
                <p style="color:#aaa; background:#111; padding:15px; border-radius:5px; direction:ltr; text-align:left; font-family:monospace; max-height:200px; overflow:auto;">${details}</p>
                <button onclick="location.reload()" style="margin-top:20px; min-width:200px;">إعادة المحاولة 🔄</button>
            </div>
        `;
    }
}

// ================== بدء التشغيل ==================
initGame().catch(err => {
    console.error('💥 خطأ غير متوقع:', err);
    showError('تعذر بدء اللعبة', err.message || String(err));
});Quaternion || transform.rotation.toQuaternion());
    const right = Vector3.Right().applyRotationQuaternion(transform.rotationQuaternion || transform.rotation.toQuaternion());

    let accel = 0;
    if (inputState.gas) accel = carStats.enginePower;
    if (inputState.brake) accel = -carStats.enginePower * 1.5;

    vehicle.steer = 0;
    if (inputState.left) vehicle.steer = 0.5;
    if (inputState.right) vehicle.steer = -0.5;

    // إذا كانت الفيزياء مفعلة، طبق القوى
    if (body) {
        body.applyForce(forward.scale(accel), transform.getAbsolutePosition());
        
        // احتكاك جانبي
        const vel = body.getLinearVelocity();
        const lateral = vel.dot(right);
        body.applyForce(right.scale(-lateral * 8), transform.getAbsolutePosition());
        
        // توجيه
        if (Math.abs(vehicle.steer) > 0.1) {
            const torque = Vector3.Up().scale(vehicle.steer * 20);
            body.applyTorque(torque);
        }
        
        // منع الانقلاب
        const rot = transform.rotationQuaternion?.toEulerAngles() || transform.rotation;
        if (Math.abs(rot.x) > 1.3 || Math.abs(rot.z) > 1.3) {
            body.setAngularVelocity(Vector3.Zero());
        }
    } else {
        // فيزياء بسيطة بدون محرك
        if (inputState.gas) {
            transform.position.addInPlace(forward.scale(0.3));
        }
        if (inputState.brake) {
            transform.position.addInPlace(forward.scale(-0.3));
        }
        if (vehicle.steer !== 0) {
            transform.rotate(Vector3.Up(), vehicle.steer * 0.05);
        }
        // جاذبية بسيطة
        transform.position.y = Math.max(transform.position.y - 0.1, 1);
    }

    // تحديث العجلات المرئية
    vehicle.wheels.forEach((wheel, i) => {
        const isFront = i < 2;
        const offsetX = (i === 0 || i === 2) ? -1.1 : 1.1;
        const offsetZ = isFront ? 1.3 : -1.3;
        
        wheel.position = transform.position.add(new Vector3(offsetX, -0.5, offsetZ));
        if (isFront) wheel.rotation.y = vehicle.steer;
        wheel.rotation.x += 0.2 + Math.abs(accel) * 0.002;
    });
}

// ================== الكاميرا ==================
function updateCamera() {
    if (!vehicle || !vehicle.chassis || !camera) return;
    const target = vehicle.chassis.position;
    
    if (cameraMode === 0) {
        camera.setTarget(target);
        camera.radius = 10;
        camera.alpha += (vehicle.chassis.rotation?.y ? -vehicle.chassis.rotation.y + Math.PI - camera.alpha : Math.PI - camera.alpha) * 0.05;
        camera.beta = Math.PI / 2.5;
    } else if (cameraMode === 1) {
        camera.position = target.add(new Vector3(0, 1.5, 0));
        camera.setTarget(target.add(Vector3.Forward().scale(-10)));
    } else {
        camera.position = target.add(new Vector3(0, 15, 0.1));
        camera.setTarget(target);
    }
}

// ================== HUD ==================
function updateHUD() {
    if (!vehicle?.chassis?.physicsAggregate?.body) return;
    const vel = vehicle.chassis.physicsAggregate.body.getLinearVelocity();
    const speed = Math.sqrt(vel.x**2 + vel.z**2) * 3.6;
    document.getElementById('speedometer').innerText = Math.floor(speed) + ' km/h';
}

// ================== واجهة المستخدم ==================
window.startGame = function(mode) {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-hud').classList.remove('hidden');
    if (vehicle) {
        vehicle.chassis.position = new Vector3(0, 5, 0);
        vehicle.chassis.rotation = new Vector3(0, 0, 0);
        vehicle.chassis.physicsAggregate?.body?.setLinearVelocity?.(Vector3.Zero());
    }
};

window.showMainMenu = function() {
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
};

window.resetCar = function() {
    if (vehicle) {
        vehicle.chassis.position = new Vector3(0, 5, 0);
        vehicle.chassis.rotation = new Vector3(0, 0, 0);
        vehicle.chassis.physicsAggregate?.body?.setLinearVelocity?.(Vector3.Zero());
        vehicle.chassis.physicsAggregate?.body?.setAngularVelocity?.(Vector3.Zero());
    }
};

window.toggleCamera = function() {
    cameraMode = (cameraMode + 1) % 3;
    console.log('📷 الكاميرا:', ['خلفية', 'قمرة القيادة', 'علوية'][cameraMode]);
};

window.showImport = function() {
    document.getElementById('import-panel').classList.remove('hidden');
};
window.closeImport = function() {
    document.getElementById('import-panel').classList.add('hidden');
};

window.showGarage = function() {
    document.getElementById('garage-panel').classList.remove('hidden');
};
window.closeGarage = function() {
    document.getElementById('garage-panel').classList.add('hidden');
};

window.changeCarColor = function(color) {
    if (vehicle?.chassis?.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function(type) {
    if (type === 'engine') carStats.enginePower *= 1.1;
    if (type === 'suspension') carStats.suspensionStiffness *= 1.2;
    alert('✅ تمت الترقية بنجاح!');
};

window.toggleSettings = function() {
    alert('⚙️ الإعدادات قيد التطوير. اضغط OK للإغلاق');
};

// ================== استيراد المودات ==================
document.getElementById('mod-file-input')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('import-status').innerText = '⏳ جاري التحليل...';
    const url = URL.createObjectURL(file);
    
    SceneLoader.ImportMeshAsync('', '', url, scene).then((result) => {
        document.getElementById('import-status').innerText = '✅ تم الاستيراد بنجاح!';
        let chassisMesh = result.meshes.find(m => m.name.toLowerCase().includes('body') || m.name.toLowerCase().includes('chassis')) || result.meshes[0];
        if (chassisMesh && havokPlugin) {
            try { chassisMesh.createDefaultPhysicsAggregate({ mass: 150 }); } catch(e) {}
        }
        closeImport();
        startGame('free');
    }).catch((err) => {
        document.getElementById('import-status').innerText = '❌ خطأ: ' + err.message;
    });
});

// ================== أزرار التحكم ==================
const bindTouch = (id, key) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); inputState[key] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); inputState[key] = false; });
    btn.addEventListener('mousedown', () => inputState[key] = true);
    btn.addEventListener('mouseup', () => inputState[key] = false);
    btn.addEventListener('mouseleave', () => inputState[key] = false);
};

bindTouch('btn-gas', 'gas');
bindTouch('btn-brake', 'brake');
bindTouch('btn-left', 'left');
bindTouch('btn-right', 'right');

window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = true;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = false;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
});

// ================== البدء ==================
initGame().catch(err => {
    console.error('💥 خطأ غير متوقع:', err);
    showError('تعذر بدء اللعبة', err.message);
});nction(color) {
    if (vehicle && vehicle.chassis.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function(type) {
    if (type === 'engine') carStats.enginePower *= 1.1;
    if (type === 'suspension') carStats.suspensionStiffness *= 1.2;
    alert('تمت الترقية بنجاح!');
};

// معالجة استيراد المودات (GLB/GLTF)
document.getElementById('mod-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('import-status').innerText = 'جاري التحليل والبناء...';
    const url = URL.createObjectURL(file);
    
    SceneLoader.ImportMeshAsync('', '', url, scene).then((result) => {
        document.getElementById('import-status').innerText = 'تم الاستيراد بنجاح!';
        
        // محاولة اكتشاف الهيكل والعجلات تلقائياً
        let chassisMesh = null;
        const wheels = [];
        
        result.meshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes('chassis') || mesh.name.toLowerCase().includes('body')) {
                chassisMesh = mesh;
            } else if (mesh.name.toLowerCase().includes('wheel')) {
                wheels.push(mesh);
            }
        });

        // إذا لم يتم العثور على أسماء واضحة، نستخدم أكبر مجسم كهيكل
        if (!chassisMesh && result.meshes.length > 0) {
            chassisMesh = result.meshes.reduce((prev, current) => (prev.getBoundingInfo().boundingBox.extendSize.length() > current.getBoundingInfo().boundingBox.extendSize.length()) ? prev : current);
        }

        if (chassisMesh) {
            // إزالة الفيزياء القديمة إذا وجدت
            if (vehicle && vehicle.chassis.physicsAggregate) {
                vehicle.chassis.physicsAggregate.dispose();
            }
            
            // تطبيق فيزياء جديدة على المود المستورد
            chassisMesh.createDefaultPhysicsAggregate({ mass: 150, friction: 0.5 });
            vehicle.chassis = chassisMesh;
            
            // تحديث العجلات إذا تم اكتشافها
            if (wheels.length >= 4) {
                vehicle.wheels = wheels.slice(0, 4);
            }
            
            closeImport();
            startGame('free');
        } else {
            document.getElementById('import-status').innerText = 'فشل في اكتشاف هيكل المركبة.';
        }
    }).catch((err) => {
        console.error(err);
        document.getElementById('import-status').innerText = 'خطأ في تحميل الملف. تأكد من أنه GLB/GLTF صالح.';
    });
});

// ربط أزرار اللمس
const bindTouch = (id, key) => {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); inputState[key] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); inputState[key] = false; });
    btn.addEventListener('mousedown', () => inputState[key] = true);
    btn.addEventListener('mouseup', () => inputState[key] = false);
};

bindTouch('btn-gas', 'gas');
bindTouch('btn-brake', 'brake');
bindTouch('btn-left', 'left');
bindTouch('btn-right', 'right');

// ربط لوحة المفاتيح
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = true;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = false;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
});

// بدء التشغيل
initGame();
