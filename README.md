# NodeJS-Multiplayer-Server
A versatile nodejs server for broadcasting object transforms between browser-based games

# usage:
## Server
Edit server.js:
`var myServer=new Server();
myServer.broadcastInterval=0.02;
myServer.broadcastImmediately=true;
myServer.pingInterval=2;
myServer.autoKickTime=2;
myServer.broadcastInterval=0.02;
myServer.createRoom("default");
myServer.start(9999);`
Cmd:
`node server.js`
## Client
`var client=require('./client')

//var myClient=new client.ClientSide("ws://localhost:9999");
var myClient=new client.ClientSide("ws://fangzhangmnm.xyz:9999");
myClient.onConnection(()=>{
    myClient.joinRoom("default");
    myClient.socket.emit("int",233);
});
var handle=myClient.createEntityNow({x:0,y:0,z:0},{x:0,y:0,z:0,w:1},{name:"entity1"});
myClient.onRoomReady(()=>{
    var handle1=myClient.createEntityNow({x:0,y:0,z:0},{x:0,y:0,z:0,w:1},{name:"entity2"});
    setInterval(()=>{
        //console.log(myClient.getRoomTime(),handle,myClient.getEntity(handle))
        myClient.getEntity(handle).p.x=Math.cos(myClient.getRoomTime());
        myClient.uploadEntityDynamics();
        myClient.uploadRemoveFlags();
        myClient.updateExtrapolate(1);
        var e1=myClient.getEntity(0),e2=myClient.getEntity(2);
        if(e1!=null && e2!=null){
            console.log(e1.p.x,e2.p.x);
        }else if(e1!=null){
            console.log(e1.p.x);
        }
    },1000);
});`
