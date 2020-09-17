const config = require('./config')
const AWS = require('aws-sdk');
const API_GATEWAY_ENDPOINT = `https://${process.env.NOTIFICATIONS_SOCKET_API}.execute-api.us-east-1.amazonaws.com/${config.get('ENV')}`;

/**
 * AWS sdk .promise() is buggy, this creates its own promise
 * It also returns the items instead of whole result
 *
 * @param  {String} Table name
 * @returns {Promise}
 */
async function scanTable(table) {
	const $ddb = getDynamo();

	return new Promise((resolve, reject) => {
		$ddb.scan({
			TableName: table
		}, (err, data) => {
			if (err) {
				return reject(err);
			}

			return resolve(data.Items);
		});
	});
}

async function getItem(table, Key) {
	const $ddb = getDynamo();
	const data = await $ddb.get({
		TableName: table,
		Key
	}).promise();

	return data.Items || data.Item;
}

function getDynamo() {
	if (process.env.IS_OFFLINE) {
		return new AWS.DynamoDB.DocumentClient({
			region: 'us-east-1',
			endpoint: process.env.DYNAMO_URL || 'http://localhost:8000'
		});
	}

	return new AWS.DynamoDB.DocumentClient();
}

function getSocketApi() {
	if (process.env.IS_OFFLINE) return new AWS.ApiGatewayManagementApi({ endpoint: process.env.SOCKET_URL || 'http://localhost:3001' });	

	return new AWS.ApiGatewayManagementApi({ endpoint: API_GATEWAY_ENDPOINT });
}

module.exports = { scanTable, getDynamo, getItem, getSocketApi };
