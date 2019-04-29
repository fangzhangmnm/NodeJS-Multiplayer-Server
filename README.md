# NodeJS-Multiplayer-Server

A versatile nodejs server for broadcasting object transforms between browsers.

Clients can create entities and register to the server. Server will broadcast the existing entities to newcoming clients.

Clients can update entity transform to the server. And the server will broadcast it immetiately, or broadcast all entities' transforms in interval.

Room support.

Fundamental ping delay compensation mechanic.

There is no security guarantee. Client can cheat the server because the game logic should be written on client side. Also since it's my first time writing a network program, I guess my code is vulnerable to attack.

Nevertheless, it is a easy-to-use startup kit for your first browser multiplayer game!


# usage:
## Server
Edit server.js:
```
var myServer=new Server();
myServer.broadcastInterval=0.02;
myServer.broadcastImmediately=true;
myServer.pingInterval=2;
myServer.autoKickTime=2;
myServer.broadcastInterval=0.02;
myServer.createRoom("default");
myServer.start(9999);
```
Cmd:
```
node server.js
```
## Client
```
var client=require('./client')

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
});
```
