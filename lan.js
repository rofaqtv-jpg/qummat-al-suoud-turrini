// lan.js - نظام لعب جماعي محلي (P2P WebRTC)
let peerConnection = null;
let isHost = false;

window.showMultiplayer = function() {
    const mode = confirm("هل تريد إنشاء غرفة جديدة؟\nموافق = إنشاء غرفة (Host)\nإلغاء = الانضمام لغرفة (Client)");
    if (mode) {
        setupHost();
    } else {
        setupClient();
    }
};

function setupHost() {
    isHost = true;
    peerConnection = new RTCPeerConnection({ iceServers: [] });
    
    peerConnection.ondatachannel = (e) => {
        const channel = e.channel;
        setupChannel(channel);
    };

    peerConnection.createDataChannel('game');
    peerConnection.createOffer().then(offer => {
        peerConnection.setLocalDescription(offer);
        // في تطبيق حقيقي، يتم نسخ هذا العرض ومشاركته مع اللاعب الآخر
        alert("انسخ هذا الكود وأرسله للاعب الآخر:\n" + btoa(JSON.stringify(offer)));
    });
}

function setupClient() {
    isHost = false;
    peerConnection = new RTCPeerConnection({ iceServers: [] });
    
    const offerStr = prompt("ألصق كود الغرفة هنا:");
    if (!offerStr) return;
    
    const offer = JSON.parse(atob(offerStr));
    peerConnection.setRemoteDescription(offer);
    
    const channel = peerConnection.createDataChannel('game');
    setupChannel(channel);
    
    peerConnection.createAnswer().then(answer => {
        peerConnection.setLocalDescription(answer);
        alert("انسخ كود الرد هذا وأرسله للمضيف:\n" + btoa(JSON.stringify(answer)));
    });
}

function setupChannel(channel) {
    channel.onopen = () => {
        alert("تم الاتصال بنجاح! بدء المزامنة.");
        // هنا يتم إرسال موقع السيارة كل إطار
        setInterval(() => {
            if (vehicle && vehicle.chassis) {
                const data = {
                    x: vehicle.chassis.position.x,
                    y: vehicle.chassis.position.y,
                    z: vehicle.chassis.position.z,
                    ry: vehicle.chassis.rotation.y
                };
                channel.send(JSON.stringify(data));
            }
        }, 50); // 20 مرة في الثانية
    };
    
    channel.onmessage = (e) => {
        // استقبال موقع اللاعب الآخر (يمكن تطويره لعرض سيارة ثانية)
        console.log("Received:", e.data);
    };
    }
